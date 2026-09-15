import os
import json
import torch
import torch.nn as nn
from PIL import Image
from torchvision import models, transforms

from app.ml.exceptions import ImageDecodeError, ModelInferenceError
from app.ml.treatment_kb import fallback_split, lookup


class SmartPlantDoctor:
    def __init__(self, model_path="exports/smart_plant_doctor_model.pth",
                 labels_path=None, device=None):
        """
        Initialize the RAYY disease-detection model.

        ``labels_path`` points at an external class-name file (e.g. the AgroScan
        ``labels.json``) used when the checkpoint bundle does not embed its own
        ``classes``/``class_names``/``labels`` metadata.
        """
        device_str = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.device = torch.device(device_str)
        self.model_path = model_path
        self.labels_path = labels_path

        print("[ML] Initializing RAYY model...")
        print(f"[ML] Loading model from: {model_path}")
        if labels_path:
            print(f"[ML] External class labels: {labels_path}")

        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Model file not found: {model_path}")

        # Safe loading of model weights / metadata bundle
        try:
            self.bundle = torch.load(model_path, map_location=self.device, weights_only=False)
        except TypeError:
            self.bundle = torch.load(model_path, map_location=self.device)

        # 1. Extract state_dict first to inspect architecture
        state_dict = self._extract_state_dict()

        # 2. Extract class names safely
        self.classes = self._extract_classes()
        self.num_classes = len(self.classes)

        print(f"[ML] Found {self.num_classes} disease classes")

        # 3. Detect hyper-parameters and architecture from state_dict & bundle
        backbone, input_size = self._detect_architecture(state_dict)
        self.temperature = float(self.bundle.get("temperature", 1.0)) if isinstance(self.bundle, dict) else 1.0

        # 4. Build neural network architecture matching checkpoint state_dict
        self.model = self._build_model(backbone, state_dict)

        # Load weights into model
        self.model.load_state_dict(state_dict)
        self.model = self.model.to(self.device).eval()
        self.backbone = backbone

        # Preprocessing transform. Prefer the checkpoint's own normalization
        # values (AgroScan stores normalization_mean / normalization_std) and fall
        # back to the standard ImageNet values for older bundles.
        norm_mean = self.bundle.get("normalization_mean", [0.485, 0.456, 0.406]) if isinstance(self.bundle, dict) else [0.485, 0.456, 0.406]
        norm_std = self.bundle.get("normalization_std", [0.229, 0.224, 0.225]) if isinstance(self.bundle, dict) else [0.229, 0.224, 0.225]
        self.transform = transforms.Compose([
            transforms.Resize((input_size, input_size)),
            transforms.ToTensor(),
            transforms.Normalize(mean=norm_mean, std=norm_std)
        ])

        # Accuracy reporting: different bundles store different metric names.
        best_acc = 0.0
        if isinstance(self.bundle, dict):
            if "best_val_acc" in self.bundle:
                best_acc = float(self.bundle.get("best_val_acc") or 0.0)
            elif "best_val_f1" in self.bundle:
                best_acc = float(self.bundle.get("best_val_f1") or 0.0)
        if "best_val_f1" in self.bundle and "best_val_acc" not in self.bundle:
            print(f"[ML] Model F1: {best_acc * 100:.2f}%")
        else:
            print(f"[ML] Model accuracy: {best_acc:.2f}%")
        print(f"[ML] Device: {self.device}")
        print(f"[ML] Input size: {input_size}x{input_size}")

    def _extract_state_dict(self):
        """Extract model weights dictionary from saved checkpoint bundle.

        Supports both wrapper-key names used across checkpoints:
        ``state_dict`` (legacy bundles) and ``model_state_dict`` (AgroScan).
        """
        if isinstance(self.bundle, dict):
            if 'model_state_dict' in self.bundle:
                return self.bundle['model_state_dict']
            if 'state_dict' in self.bundle:
                return self.bundle['state_dict']
            # Raw state_dict bundle (no wrapper dict)
            return self.bundle
        return self.bundle

    @staticmethod
    def _is_non_leaf_class(class_name: str) -> bool:
        """True when the predicted class is a non-leaf / unknown placeholder.

        AgroScan ships a ``Non_leaf_or_unknown`` class for images that are not a
        usable leaf photo. Such results must never be dressed up as a plant
        disease diagnosis.
        """
        if not isinstance(class_name, str):
            return False
        text = class_name.strip().lower()
        return text in {
            "non_leaf_or_unknown",
            "non_leaf",
            "unknown",
            "not_a_leaf",
            "background",
            "no_leaf",
        }

    def _load_external_labels(self):
        """Load class names from an external labels file (labels.json / model_manifest.json).

        AgroScan ships its class names in a separate file rather than embedding
        them in the checkpoint. Returns a list of class-name strings or None.
        """
        if not self.labels_path or not os.path.exists(self.labels_path):
            return None
        try:
            with open(self.labels_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as exc:
            print(f"[ML] Could not read labels file {self.labels_path}: {exc}")
            return None

        # model_manifest.json: {"classes": [...], "num_classes": 39, ...}
        if isinstance(data, dict):
            for key in ("classes", "class_names", "labels", "idx_to_class", "label_names"):
                if key in data:
                    value = data[key]
                    if isinstance(value, dict):
                        return [value[k] for k in sorted(value.keys(), key=int)]
                    return list(value)
            return None

        # labels.json: plain list, or {index: name}, or list of {name: ...}
        if isinstance(data, list):
            return [item if isinstance(item, str) else item.get("name", item.get("label", str(item)))
                    for item in data]
        return None

    def _extract_classes(self):
        """Extract classes list from bundle, external labels file, or state_dict.

        Priority:
        1. ``classes``/``class_names``/``labels``/``idx_to_class`` inside the bundle.
        2. External ``labels.json`` / ``model_manifest.json`` (AgroScan).
        3. Output dimension of the classifier layer (falls back to Class_N).
        """
        # 1. Embedded bundle metadata
        if isinstance(self.bundle, dict):
            for key in ['classes', 'class_names', 'labels', 'idx_to_class']:
                if key in self.bundle:
                    extracted = self.bundle[key]
                    if isinstance(extracted, dict):
                        return [extracted[k] for k in sorted(extracted.keys())]
                    return list(extracted)

        # 2. External labels file (AgroScan)
        external = self._load_external_labels()
        if external:
            return external

        # 3. Fallback to output dimension of classifier layer in checkpoint
        state_dict = self._extract_state_dict()
        for key in ['classifier.1.weight', 'classifier.4.weight', 'classifier.weight']:
            if key in state_dict:
                num_classes = state_dict[key].shape[0]
                return [f"Class_{i}" for i in range(num_classes)]

        return [f"Class_{i}" for i in range(65)]

    def _detect_architecture(self, state_dict):
        """Auto-detect backbone architecture and input size from checkpoint metadata.

        Prefers explicit metadata fields (``architecture``, ``model_architecture``,
        ``backbone``, ``input_size``) because they are authoritative. Falls back
        to inspecting state_dict key signatures for older bundles that omit them.
        """
        saved_backbone = None
        if isinstance(self.bundle, dict):
            saved_backbone = (
                self.bundle.get("architecture")
                or self.bundle.get("model_architecture")
                or self.bundle.get("backbone")
            )
        input_size = self.bundle.get("input_size", 224) if isinstance(self.bundle, dict) else 224

        if saved_backbone:
            return saved_backbone, input_size

        # Check key signatures in state_dict
        keys = list(state_dict.keys())
        is_efficientnet = any('.block.' in k for k in keys)

        if is_efficientnet:
            # Check classifier input feature dimension to distinguish EfficientNet variants
            if 'classifier.1.weight' in state_dict:
                in_feat = state_dict['classifier.1.weight'].shape[1]
                if in_feat == 1536:
                    return "efficientnet_b3", 300
                elif in_feat == 1280:
                    return "efficientnet_b0", 224
            return "efficientnet_b0", 224

        return "mobilenet_v2", 224

    def _build_model(self, backbone, state_dict):
        """Build model and adapt classifier head matching checkpoint dimensions."""
        if "efficientnet" in backbone:
            if backbone == "efficientnet_b3":
                model = models.efficientnet_b3(weights=None)
            else:
                model = models.efficientnet_b0(weights=None)

            # Detect classifier structure saved in checkpoint
            if 'classifier.4.weight' in state_dict:
                # 2-layer classifier: Dropout -> Linear(1280/1536, 512) -> ReLU -> Dropout -> Linear(512, num_classes)
                in_features = model.classifier[1].in_features
                model.classifier = nn.Sequential(
                    nn.Dropout(p=0.2, inplace=True),
                    nn.Linear(in_features, 512),
                    nn.ReLU(inplace=True),
                    nn.Dropout(p=0.2, inplace=True),
                    nn.Linear(512, self.num_classes),
                )
            else:
                # Direct classifier: Dropout -> Linear(in_features, num_classes)
                in_features = state_dict['classifier.1.weight'].shape[1] if 'classifier.1.weight' in state_dict else model.classifier[1].in_features
                out_features = state_dict['classifier.1.weight'].shape[0] if 'classifier.1.weight' in state_dict else self.num_classes
                model.classifier = nn.Sequential(
                    nn.Dropout(p=0.2, inplace=True),
                    nn.Linear(in_features, out_features),
                )
            return model

        # Default MobileNetV2 fallback
        model = models.mobilenet_v2(weights=None)
        if 'classifier.4.weight' in state_dict:
            model.classifier = nn.Sequential(
                nn.Dropout(0.2),
                nn.Linear(model.last_channel, 512),
                nn.ReLU(inplace=True),
                nn.Dropout(0.2),
                nn.Linear(512, self.num_classes),
            )
        else:
            out_features = state_dict['classifier.1.weight'].shape[0] if 'classifier.1.weight' in state_dict else self.num_classes
            model.classifier = nn.Sequential(
                nn.Dropout(0.2),
                nn.Linear(model.last_channel, out_features),
            )
        return model

    @torch.no_grad()
    def predict(self, image_path):
        """
        Run inference on an input image file path.

        Raises:
            ImageDecodeError: if the file at image_path isn't a valid, decodable image.
            ModelInferenceError: if the model itself fails to produce a prediction.
        """
        try:
            image = Image.open(image_path)
            image.load()  # force full decode now, not lazily on first use
            image = image.convert('RGB')
        except Exception as exc:
            raise ImageDecodeError(f"Could not decode image: {exc}") from exc

        try:
            image_tensor = self.transform(image).unsqueeze(0).to(self.device)

            output = self.model(image_tensor)
            output = output / max(self.temperature, 1e-6)
            probabilities = torch.softmax(output, dim=1)[0]

            top_prob, top_class_idx = torch.max(probabilities, dim=0)
            predicted_class = self.classes[top_class_idx.item()]
        except Exception as exc:
            raise ModelInferenceError(f"Model inference failed: {exc}") from exc

        info = lookup(predicted_class)
        if info:
            plant, disease = info['plant'], info['disease']
            treatment = info['treatment']
        else:
            plant, disease = fallback_split(predicted_class)
            treatment = None

        return {
            'plant': plant,
            'disease': disease,
            'confidence': float(top_prob.item()) * 100,
            'class_name': predicted_class,
            'treatment': treatment,
            'output_format': f"Plant is {plant} and has {disease} disease",
            'non_leaf': self._is_non_leaf_class(predicted_class),
        }