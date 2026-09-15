from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.encyclopedia_data import CATEGORIES
from app.models import DiseaseReport, SpeciesProfile, User
from app.schemas import CategoryOut, DiseaseMapPoint, DiseaseReportCreate, SpeciesProfileOut
from app.services.geohash_util import encode as geohash_encode

router = APIRouter(tags=["content"])


def _bucket_geohash(lat: float, lng: float, precision: int = 4) -> str:
    return geohash_encode(lat, lng, precision=precision)


@router.get("/encyclopedia", response_model=list[SpeciesProfileOut])
def list_species(
    db: Session = Depends(get_db),
    q: str | None = Query(default=None, description="بحث بالاسم العربي أو الإنجليزي أو العلمي"),
    category: str | None = Query(default=None, description="مفتاح الفئة، أو 'all'"),
):
    """List encyclopedia entries.

    Backward compatible: called with no query params it behaves exactly as
    before (returns every species, ordered by the English key). `q` and
    `category` are additive, optional filters for the redesigned Arabic UI.
    """
    query = db.query(SpeciesProfile)

    if category and category != "all":
        query = query.filter(SpeciesProfile.category == category)

    if q:
        needle = f"%{q.strip()}%"
        query = query.filter(
            or_(
                SpeciesProfile.species.ilike(needle),
                SpeciesProfile.name_ar.ilike(needle),
                SpeciesProfile.name_en.ilike(needle),
                SpeciesProfile.scientific_name.ilike(needle),
                SpeciesProfile.family.ilike(needle),
            )
        )

    results = query.order_by(SpeciesProfile.species).all()

    if q:
        # Aliases are stored as JSON and can't be filtered in SQL portably
        # across SQLite/Postgres, so also match against them in Python and
        # merge in anything the SQL filter above missed.
        needle_plain = q.strip().lower()
        already_ids = {r.id for r in results}
        alias_matches = [
            p
            for p in db.query(SpeciesProfile).all()
            if p.id not in already_ids
            and (not category or category == "all" or p.category == category)
            and p.aliases
            and any(needle_plain in str(a).lower() for a in p.aliases)
        ]
        results = sorted(results + alias_matches, key=lambda p: p.species)

    return results


@router.get("/encyclopedia/categories", response_model=list[CategoryOut])
def list_categories():
    return CATEGORIES


@router.get("/encyclopedia/{species}", response_model=SpeciesProfileOut)
def get_species(species: str, db: Session = Depends(get_db)):
    profile = db.query(SpeciesProfile).filter(SpeciesProfile.species == species).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Species not found")
    return profile


@router.post("/disease-reports", status_code=201)
def create_disease_report(
    payload: DiseaseReportCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    gh = "unknown"
    if payload.latitude is not None and payload.longitude is not None:
        gh = _bucket_geohash(payload.latitude, payload.longitude)
    report = DiseaseReport(
        user_id=None,
        disease=payload.disease,
        species=payload.species,
        geohash=gh,
        region=payload.region,
    )
    db.add(report)
    db.commit()
    return {"ok": True}


@router.get("/disease-map", response_model=list[DiseaseMapPoint])
def disease_map(region: str | None = Query(default=None), db: Session = Depends(get_db)):
    q = db.query(
        DiseaseReport.geohash,
        DiseaseReport.region,
        DiseaseReport.disease,
        func.count(DiseaseReport.id).label("count"),
    ).group_by(DiseaseReport.geohash, DiseaseReport.region, DiseaseReport.disease)
    if region:
        q = q.filter(DiseaseReport.region == region)
    rows = q.all()
    return [
        DiseaseMapPoint(geohash=r.geohash, region=r.region, disease=r.disease, count=r.count)
        for r in rows
    ]
