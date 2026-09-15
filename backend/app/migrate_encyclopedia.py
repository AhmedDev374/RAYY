"""Safe migration: add new Encyclopedia columns to `species_profiles`.

The redesigned Arabic Encyclopedia (موسوعة رَيّ) needs extra columns on the
existing `species_profiles` table. This script:

  1. Adds any missing columns (name_ar, name_en, scientific_name, family,
     category, aliases, image_url, description_ar, watering_ar,
     fertilization_ar, greenhouse_guidance_ar, common_pests,
     nutrient_deficiencies, ai_support) using ALTER TABLE ADD COLUMN.
  2. Runs `app.services.seed.seed_species_profiles(db)` to populate the
     new/updated rows.

It is fully idempotent — running it again is a no-op for columns that already
exist and a no-op for species that are already seeded. It NEVER drops or
truncates any table, so users, plants, diagnoses, devices, readings, care
events, disease reports, etc. are all preserved untouched.

Usage:
    python -m backend.app.migrate_encyclopedia
    # or from inside the backend/ directory:
    python -m app.migrate_encyclopedia
"""

from __future__ import annotations

import logging

from sqlalchemy import text

from app.database import SessionLocal, engine
from app.services.seed import seed_species_profiles

logger = logging.getLogger("encyclopedia.migrate")

# (column_name, sql_type, default_clause)
# default_clause is the SQL fragment appended after the type, e.g.
# 'DEFAULT ""' or 'DEFAULT 0'. Use 'NOT NULL DEFAULT ...' only when every
# existing row already has a value — here we use nullable + application-level
# defaults so an empty pre-existing table still works.
NEW_COLUMNS: list[tuple[str, str, str]] = [
    ("name_ar", "VARCHAR(120)", 'DEFAULT ""'),
    ("name_en", "VARCHAR(120)", 'DEFAULT ""'),
    ("scientific_name", "VARCHAR(160)", 'DEFAULT ""'),
    ("family", "VARCHAR(120)", 'DEFAULT ""'),
    ("category", "VARCHAR(40)", 'DEFAULT ""'),
    ("aliases", "JSON", "NULL"),
    ("image_url", "VARCHAR(500)", "NULL"),
    ("description_ar", "TEXT", 'DEFAULT ""'),
    ("watering_ar", "TEXT", 'DEFAULT ""'),
    ("fertilization_ar", "TEXT", 'DEFAULT ""'),
    ("greenhouse_guidance_ar", "TEXT", 'DEFAULT ""'),
    ("common_pests", "JSON", "NULL"),
    ("nutrient_deficiencies", "JSON", "NULL"),
    ("ai_support", "JSON", 'DEFAULT \'{"supported": false, "model": null}\''),
]


def _existing_columns(db) -> set[str]:
    rows = db.execute(text("PRAGMA table_info(species_profiles)")).fetchall()
    return {r[1] for r in rows}


def add_missing_columns(db) -> list[str]:
    existing = _existing_columns(db)
    added: list[str] = []
    for name, coltype, default_clause in NEW_COLUMNS:
        if name in existing:
            continue
        sql = f"ALTER TABLE species_profiles ADD COLUMN {name} {coltype} {default_clause}".strip()
        logger.info("Adding column: %s", sql)
        db.execute(text(sql))
        added.append(name)
    db.commit()
    return added


def run() -> None:
    db = SessionLocal()
    try:
        added = add_missing_columns(db)
        if added:
            logger.info("Added %d new column(s) to species_profiles: %s", len(added), added)
        else:
            logger.info("species_profiles schema already up to date; no columns added.")

        seed_species_profiles(db)
        count = db.execute(text("SELECT COUNT(*) FROM species_profiles")).scalar()
        logger.info("species_profiles now contains %d row(s).", count)
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()