"""Bring an already-deployed database in line with the current models.

`Base.metadata.create_all()` only ever *creates missing tables*. It never
touches a table that already exists, so a column added to a model after that
table shipped is silently absent from the database and every query against
the table fails at runtime with:

    sqlalchemy.exc.OperationalError: no such column: control_settings.water_used_date

That is exactly what happened to the Control Center: the monitoring tables
predated the new `control_settings` table, a later change added one column to
it, and `GET /api/v1/control/status/{plant_id}` answered 500 while the rest of
the dashboard kept working.

This module performs the one migration step that is safe to run unattended on
every startup: `ALTER TABLE ... ADD COLUMN` for columns the models declare and
the database is missing. It is deliberately conservative:

* additive only — nothing is ever dropped, renamed or retyped, and no data is
  moved, so an operator's data cannot be lost by starting the API;
* idempotent — a second startup finds nothing missing and does nothing;
* driver-agnostic — plain `ALTER TABLE ADD COLUMN`, supported by SQLite (the
  default `data/app.db`) and by PostgreSQL (the Supabase deployment);
* loud — everything it changes is logged, and anything it cannot fix safely is
  logged as an error instead of being papered over.

Anything beyond adding a column (renames, type changes, data backfills with
business rules) still belongs in a real migration tool; this only removes the
"the API 500s because a column is missing" failure mode.
"""

from __future__ import annotations

import logging

from sqlalchemy import Column, Engine, inspect, text

# Importing the models is what registers their tables on Base.metadata. Without
# this the sync would iterate an empty metadata and silently report "no drift"
# on a database that is in fact missing columns.
import app.models  # noqa: F401  (side effect: table registration)
from app.database import Base

logger = logging.getLogger("rayy.schema")


def _column_ddl(dialect, table_name: str, column: Column) -> str:
    """`ALTER TABLE` statement adding one column, typed for this dialect."""
    type_sql = column.type.compile(dialect=dialect)
    # NOT NULL can only be added straight away when the database can fill the
    # existing rows itself (a server-side default). Otherwise the column is
    # added as nullable and backfilled from the model default below -- adding
    # it as NOT NULL would be rejected by SQLite for a non-empty table.
    nullable = ""
    if not column.nullable and column.server_default is not None:
        nullable = " NOT NULL"
    return f'ALTER TABLE "{table_name}" ADD COLUMN "{column.name}" {type_sql}{nullable}'


def _model_default(column: Column):
    """The scalar default a model declares, or None (callables are skipped)."""
    default = column.default
    if default is None or getattr(default, "is_callable", False):
        return None
    return default.arg


def sync_schema(engine: Engine) -> list[str]:
    """Add model columns that the deployed database is missing.

    Returns the list of `<table>.<column>` pairs that were added, so the
    caller can log them (and tests can assert on them).
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    added: list[str] = []

    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            # Brand-new table: create_all() has already created it.
            continue
        present = {column["name"] for column in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in present:
                continue
            try:
                with engine.begin() as connection:
                    connection.execute(text(_column_ddl(engine.dialect, table.name, column)))
            except Exception:  # noqa: BLE001 - report, never block startup
                logger.exception(
                    "Could not add column %s.%s automatically. Add it manually "
                    "(additive, nullable) before starting the API against this database.",
                    table.name,
                    column.name,
                )
                continue

            added.append(f"{table.name}.{column.name}")
            logger.warning(
                "Schema sync: added missing column %s.%s (was declared by the model "
                "but absent from the database).",
                table.name,
                column.name,
            )

            default = _model_default(column)
            if not column.nullable and default is not None:
                # Existing rows need the value the model would have written.
                with engine.begin() as connection:
                    connection.execute(
                        text(
                            f'UPDATE "{table.name}" SET "{column.name}" = :value '
                            f'WHERE "{column.name}" IS NULL'
                        ),
                        {"value": default},
                    )

    if added:
        logger.warning(
            "Schema sync applied %d additive change(s): %s",
            len(added),
            ", ".join(added),
        )
    return added


def report_drift(engine: Engine) -> list[str]:
    """Columns declared by the models but missing from the database.

    Used by tests and diagnostics to detect drift without changing anything.
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    missing: list[str] = []
    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            missing.append(f"{table.name} (table)")
            continue
        present = {column["name"] for column in inspector.get_columns(table.name)}
        missing.extend(
            f"{table.name}.{column.name}" for column in table.columns if column.name not in present
        )
    return missing
