"""Seed `species_profiles` for the Arabic Plant Encyclopedia (موسوعة رَيّ).

All actual content (Arabic copy, thresholds, categories, etc.) lives in
`app.encyclopedia_data.SPECIES_DATA` — this module just maps that data onto
the `SpeciesProfile` ORM model and keeps the original `care_guide` /
`seasonal_tips` text fields populated for backward compatibility with any
existing integration that still reads them directly.
"""

from app.encyclopedia_data import SPECIES_DATA


def _legacy_care_guide(entry: dict) -> str:
    """Builds a single Markdown blob out of the structured Arabic fields so
    the original `care_guide` text column (still read by older clients)
    keeps working without any code on their side changing."""
    return (
        f"## الوصف\n{entry['description_ar']}\n\n"
        f"## الري\n{entry['watering_ar']}\n\n"
        f"## التسميد\n{entry['fertilization_ar']}\n\n"
        f"## إرشادات الصوبة الزراعية\n{entry['greenhouse_guidance_ar']}"
    )


def seed_species_profiles(db):
    from app.models import SpeciesProfile

    existing = {p.species: p for p in db.query(SpeciesProfile).all()}

    for entry in SPECIES_DATA:
        common_diseases = entry["common_diseases"]

        if entry["species"] not in existing:
            profile = SpeciesProfile(
                species=entry["species"],
                name_ar=entry["name_ar"],
                name_en=entry["name_en"],
                scientific_name=entry["scientific_name"],
                family=entry["family"],
                category=entry["category"],
                aliases=entry["aliases"],
                image_url=entry.get("image_url"),
                description_ar=entry["description_ar"],
                watering_ar=entry["watering_ar"],
                fertilization_ar=entry["fertilization_ar"],
                greenhouse_guidance_ar=entry["greenhouse_guidance_ar"],
                common_pests=entry["common_pests"],
                nutrient_deficiencies=entry["nutrient_deficiencies"],
                ai_support={"supported": False, "model": None},
                thresholds=entry["thresholds"],
                care_guide=_legacy_care_guide(entry),
                seasonal_tips=entry["seasonal_tips_ar"],
                common_diseases=common_diseases,
            )
            db.add(profile)
        else:
            # Species already seeded (e.g. from the original English-only
            # data set) — refresh it in place with the new Arabic content
            # instead of skipping it, so upgrading an existing deployment
            # actually shows the redesigned Encyclopedia.
            profile = existing[entry["species"]]
            profile.name_ar = entry["name_ar"]
            profile.name_en = entry["name_en"]
            profile.scientific_name = entry["scientific_name"]
            profile.family = entry["family"]
            profile.category = entry["category"]
            profile.aliases = entry["aliases"]
            profile.image_url = entry.get("image_url")
            profile.description_ar = entry["description_ar"]
            profile.watering_ar = entry["watering_ar"]
            profile.fertilization_ar = entry["fertilization_ar"]
            profile.greenhouse_guidance_ar = entry["greenhouse_guidance_ar"]
            profile.common_pests = entry["common_pests"]
            profile.nutrient_deficiencies = entry["nutrient_deficiencies"]
            if not profile.ai_support:
                profile.ai_support = {"supported": False, "model": None}
            profile.thresholds = entry["thresholds"]
            profile.care_guide = _legacy_care_guide(entry)
            profile.seasonal_tips = entry["seasonal_tips_ar"]
            profile.common_diseases = common_diseases

    db.commit()
