import logging
import re
from pathlib import Path

from app.config import get_settings
from app.ml.exceptions import ImageDecodeError, ModelInferenceError
from app.ml.inference import SmartPlantDoctor

logger = logging.getLogger("rayy.ml")

settings = get_settings()
_model = None

# Absolute path to the production 29-class MobileNetV2 bundle that ships with
# the backend package. Resolving it here (relative to this file) makes model
# loading independent of the process working directory.
_BUNDLED_MODEL = (
    Path(__file__).resolve().parent.parent / "ml" / "exports" / "smart_plant_doctor_model.pth"
)

# AgroScan ships its class names in a separate file next to the checkpoint.
# The inference layer reads it when the bundle does not embed class metadata.
_BUNDLED_LABELS = (
    Path(__file__).resolve().parent.parent / "ml" / "exports" / "labels.json"
)
_MANIFEST_LABELS = (
    Path(__file__).resolve().parent.parent / "ml" / "exports" / "model_manifest.json"
)

# Absolute path to the older 65-class EfficientNet-B3 checkpoint in the AI
# training repo. It has NO class-name metadata, so inference falls back to
# Class_0..Class_64. Kept as a last-resort fallback only; never the default.
_REPO_MODEL = (
    Path(__file__).resolve().parents[3] / "ai" / "exports" / "smart_plant_doctor_model.pth"
)
_REPO_LABELS = (
    Path(__file__).resolve().parents[3] / "ai" / "exports" / "labels.json"
)


class DiagnosisError(Exception):
    """Raised by run_diagnosis with a stable, client-safe error code + message."""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def _resolve_configured_model_path() -> Path | None:
    """Resolve settings.model_path relative to the backend package, not the CWD.

    A relative ``model_path`` such as ``"app/ml/exports/..."`` is written relative
    to the ``backend/`` directory (the package root that contains ``app/``).
    Resolving it there keeps the path stable regardless of the process CWD, which
    is the whole point: the old default ``"../ai/exports/..."`` silently loaded a
    different, metadata-free 65-class checkpoint whenever Uvicorn was launched
    from the repo root.
    """
    configured = settings.model_path
    if not configured:
        return None
    candidate = Path(configured)
    if candidate.is_absolute() and candidate.is_file():
        return candidate
    # Resolve relative to the backend package root (parents[2] of this file),
    # which contains the ``app/`` directory that ``model_path`` is written against.
    backend_root = Path(__file__).resolve().parents[2]
    relative = backend_root / candidate
    if relative.is_file():
        return relative
    # Last try: relative to the current working directory (legacy behaviour).
    if candidate.is_file():
        return candidate
    return None


def _model_path() -> Path:
    """Pick the model weights to load, in order of preference.

    1. An explicit absolute path from settings.model_path.
    2. settings.model_path resolved relative to the backend app package.
    3. The 29-class MobileNetV2 bundle bundled with the backend package.
    4. The 65-class repo checkpoint (last resort; no class metadata).
    """
    configured = _resolve_configured_model_path()
    if configured is not None:
        return configured
    if _BUNDLED_MODEL.is_file():
        return _BUNDLED_MODEL
    if _REPO_MODEL.is_file():
        return _REPO_MODEL
    raise FileNotFoundError(
        f"Model weights not found. Checked {_BUNDLED_MODEL} and {_REPO_MODEL}"
    )


def _is_raw_class_label(value: object) -> bool:
    """True when a value is a generic model fallback like ``Class_45`` / ``class 12``.

    The model emits these whenever a predicted class index has no verified entry
    in the plant/disease knowledge base. They are NOT real plant or disease
    names, so the service must strip them before they ever reach the client.
    """
    if not isinstance(value, str):
        return False
    return bool(re.match(r"^class[\s_-]?\d+$", value.strip(), re.IGNORECASE))


def _is_raw_class_component(value: object) -> bool:
    """True for the split halves of a ``Class_N`` fallback.

    ``fallback_split`` turns ``Class_45`` into ``plant="Class"`` and
    ``disease="45"``. Either half alone is meaningless as a real plant or
    disease name, so we treat a bare ``"Class"`` plant or a numeric-only
    disease as unmapped too.
    """
    if not isinstance(value, str):
        return False
    text = value.strip()
    if text.lower() == "class":
        return True
    return bool(re.match(r"^\d+$", text))


def _normalize_result(result: dict) -> dict:
    """Drop generic ``Class_N`` fallbacks so the client never renders fake names.

    A result is considered unmapped when either ``plant`` or ``disease`` is a
    raw class label (or one of its split halves). In that case both are cleared
    to ``None``; the frontend already renders an honest "unable to identify"
    state instead of dressing a raw identifier up as a diagnosis. Valid mapped
    classes are untouched.
    """
    plant = result.get("plant")
    disease = result.get("disease")
    if (
        _is_raw_class_label(plant)
        or _is_raw_class_label(disease)
        or _is_raw_class_component(plant)
        or _is_raw_class_component(disease)
    ):
        result["plant"] = None
        result["disease"] = None
        result["unmapped"] = True
        # Never let a raw Class_N identifier reach the client, even in the
        # diagnostic-only field. Keep the field present (None) so the shape is
        # stable, but the value is no longer a raw model label.
        result["class_name"] = None
    else:
        result["unmapped"] = False
    return result


def _labels_path(model_path: Path) -> Path | None:
    """Pick the external class-name file that pairs with the loaded model.

    AgroScan ships ``labels.json`` / ``model_manifest.json`` next to the
    checkpoint. Returns the first existing candidate, or None.
    """
    directory = model_path.parent
    for candidate in (
        directory / "labels.json",
        directory / "model_manifest.json",
    ):
        if candidate.is_file():
            return candidate
    # Repo-level fallback for the old 65-class checkpoint.
    if model_path == _REPO_MODEL and _REPO_LABELS.is_file():
        return _REPO_LABELS
    return None


def _log_model_loaded(model: SmartPlantDoctor, path: Path) -> None:
    """Emit a single diagnostic line so it is obvious which model is in use."""
    classes = getattr(model, "classes", []) or []
    logger.info(
        "MODEL LOADED: path=%s architecture=%s num_classes=%d classes_source=%s first_classes=%s",
        str(path),
        getattr(model, "backbone", "?"),
        len(classes),
        "bundle" if classes and not str(classes[0]).startswith("Class_") else "fallback",
        list(classes[:5]),
    )


def _get_model():
    global _model
    if _model is None:
        model_path = _model_path()
        labels_path = _labels_path(model_path)
        _model = SmartPlantDoctor(
            model_path=str(model_path),
            labels_path=str(labels_path) if labels_path else None,
        )
        _log_model_loaded(_model, model_path)
        if labels_path:
            logger.info("MODEL LABELS: path=%s", str(labels_path))
    return _model


def run_diagnosis(image_path: str) -> dict:
    try:
        model = _get_model()
    except FileNotFoundError as exc:
        # Model weights missing/misconfigured on the server - this is an ops issue,
        # never expose the file path to the client.
        raise DiagnosisError(
            "MODEL_ERROR", "The AI analysis service is temporarily unavailable."
        ) from exc

    try:
        result = model.predict(image_path)
    except ImageDecodeError as exc:
        raise DiagnosisError(
            "INVALID_IMAGE", "The uploaded image could not be decoded. Please try a different photo."
        ) from exc
    except ModelInferenceError as exc:
        raise DiagnosisError(
            "MODEL_ERROR", "The AI analysis service failed. Please try again in a moment."
        ) from exc

    # AgroScan emits a Non_leaf_or_unknown class for images that are not a usable
    # leaf photo. Never dress that up as a plant disease diagnosis.
    if result.get("non_leaf"):
        return {
            "status": "non_leaf",
            "message": "The uploaded image does not appear to contain a usable leaf photo. Please upload a clear, close-up image of a leaf.",
            "confidence": float(result.get("confidence") or 0),
            "plant": None,
            "disease": None,
            "class_name": result.get("class_name"),
            "unmapped": True,
            "non_leaf": True,
        }

    confidence = (result.get("confidence") or 0) / 100.0
    calibrated = max(0.0, min(confidence, 1.0))
    result = _normalize_result(result)

    if calibrated < settings.confidence_threshold:
        return {
            "status": "low_confidence",
            "message": "Try a clearer photo — ensure good lighting and focus on affected leaves.",
            "confidence": calibrated * 100,
            "plant": result.get("plant"),
            "disease": result.get("disease"),
            "class_name": result.get("class_name"),
            "unmapped": result.get("unmapped", False),
        }

    return {
        "status": "success",
        "plant": result.get("plant"),
        "disease": result.get("disease"),
        "confidence": calibrated * 100,
        "class_name": result.get("class_name"),
        "treatment": result.get("treatment"),
        "output_format": result.get("output_format"),
        "unmapped": result.get("unmapped", False),
    }