import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.deps import get_current_user
from app.models import Diagnosis, Plant, User
from app.schemas import DiagnosisOut
from app.services.inference_service import DiagnosisError, run_diagnosis

router = APIRouter(prefix="/diagnose", tags=["diagnosis"])
settings = get_settings()


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"status": "error", "code": code, "message": message},
    )


@router.post("", response_model=dict)
async def diagnose(
    file: UploadFile = File(...),
    plant_id: int | None = Form(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if plant_id:
        plant = db.query(Plant).filter(Plant.id == plant_id, Plant.user_id == user.id).first()
        if not plant:
            raise HTTPException(status_code=404, detail="Plant not found")

    if not file or not file.filename:
        raise _error(400, "NO_IMAGE", "Please select an image to analyze.")

    if file.content_type not in settings.allowed_image_type_list:
        raise _error(
            415,
            "UNSUPPORTED_IMAGE_TYPE",
            f"Unsupported image type '{file.content_type}'. Please upload a JPEG, PNG, or WEBP image.",
        )

    content = await file.read()

    if not content:
        raise _error(400, "EMPTY_IMAGE", "The uploaded file is empty. Please try a different photo.")

    if len(content) > settings.max_upload_size_bytes:
        raise _error(
            413,
            "IMAGE_TOO_LARGE",
            f"Image is too large (max {settings.max_upload_size_mb}MB). Please upload a smaller photo.",
        )

    uploads = Path(settings.uploads_dir)
    uploads.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "image.jpg").suffix or ".jpg"
    filename = f"{uuid.uuid4().hex}{ext}"
    dest = uploads / filename
    dest.write_bytes(content)

    try:
        result = run_diagnosis(str(dest))
    except DiagnosisError as exc:
        # Don't leave an unusable upload sitting around, and never leak internals.
        dest.unlink(missing_ok=True)
        status_code = 422 if exc.code == "INVALID_IMAGE" else 503
        raise _error(status_code, exc.code, exc.message) from exc

    image_url = f"/uploads/{filename}"
    diagnosis = Diagnosis(
        plant_id=plant_id,
        user_id=user.id,
        image_url=image_url,
        class_name=result.get("class_name"),
        plant_species=result.get("plant"),
        disease=result.get("disease"),
        confidence=result.get("confidence"),
        status=result.get("status", "success"),
        treatment_json=result.get("treatment"),
    )
    db.add(diagnosis)
    db.commit()
    db.refresh(diagnosis)

    return {
        "diagnosis_id": diagnosis.id,
        "image_url": image_url,
        **result,
    }


@router.get("/history", response_model=list[DiagnosisOut])
def diagnosis_history(
    plant_id: int | None = None,
    limit: int = 50,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Diagnosis).filter(Diagnosis.user_id == user.id)
    if plant_id:
        q = q.filter(Diagnosis.plant_id == plant_id)
    return q.order_by(Diagnosis.created_at.desc()).limit(limit).all()


@router.get("/plants/{plant_id}/diagnoses", response_model=list[DiagnosisOut])
def plant_diagnoses(
    plant_id: int,
    limit: int = 50,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    plant = db.query(Plant).filter(Plant.id == plant_id, Plant.user_id == user.id).first()
    if not plant:
        raise HTTPException(status_code=404, detail="Plant not found")
    return (
        db.query(Diagnosis)
        .filter(Diagnosis.plant_id == plant_id)
        .order_by(Diagnosis.created_at.desc())
        .limit(limit)
        .all()
    )


@router.get("/history/{diagnosis_id}", response_model=DiagnosisOut)
def diagnosis_detail(
    diagnosis_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Fetch a single diagnosis by id.

    Ownership is enforced: a user can only read their own diagnosis records.
    A non-existent or foreign id returns 404 so callers can't distinguish
    existence from permission.
    """
    diagnosis = (
        db.query(Diagnosis)
        .filter(Diagnosis.id == diagnosis_id, Diagnosis.user_id == user.id)
        .first()
    )
    if not diagnosis:
        raise HTTPException(status_code=404, detail="Diagnosis not found")
    return diagnosis


@router.delete("/history/{diagnosis_id}", status_code=204)
def delete_diagnosis(
    diagnosis_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Permanently delete a diagnosis record.

    Ownership is enforced before any deletion happens — a user can never
    delete another user's record. The associated uploaded image is removed
    from disk when it is safe to do so (the file is only referenced by this
    one diagnosis row, which is the case for every upload created by the
    /diagnose endpoint). A failure to delete the file is logged but does not
    block the database deletion, so the user always gets a clean result.
    """
    import logging

    logger = logging.getLogger("diagnosis.delete")

    diagnosis = (
        db.query(Diagnosis)
        .filter(Diagnosis.id == diagnosis_id, Diagnosis.user_id == user.id)
        .first()
    )
    if not diagnosis:
        raise HTTPException(status_code=404, detail="Diagnosis not found")

    image_url = diagnosis.image_url
    db.delete(diagnosis)
    db.commit()

    # Best-effort file cleanup: the uploads dir is served at /uploads/<filename>.
    if image_url and image_url.startswith("/uploads/"):
        filename = image_url[len("/uploads/"):]
        if filename and "/" not in filename and ".." not in filename:
            from pathlib import Path

            from app.config import get_settings

            uploads = Path(get_settings().uploads_dir)
            candidate = uploads / filename
            try:
                if candidate.is_file():
                    candidate.unlink(missing_ok=True)
                    logger.info("Deleted upload file for diagnosis %s: %s", diagnosis_id, candidate)
            except OSError as exc:
                logger.warning("Could not delete upload file %s: %s", candidate, exc)

    return None