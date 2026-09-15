"""Add Arabic Encyclopedia fields to species_profiles.

`Base.metadata.create_all()` (run on every startup in `app.main.lifespan`)
only creates missing *tables*, not missing *columns* on tables that already
exist. Since `species_profiles` already exists in any deployed database,
this migration adds the new columns explicitly so existing deployments pick
up the redesigned Encyclopedia without dropping data.
"""

import sqlalchemy as sa
from alembic import op

revision = "002_encyclopedia_fields"
down_revision = "001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("species_profiles") as batch_op:
        batch_op.add_column(sa.Column("name_ar", sa.String(length=120), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("name_en", sa.String(length=120), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("scientific_name", sa.String(length=160), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("family", sa.String(length=120), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("category", sa.String(length=40), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("aliases", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("image_url", sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column("description_ar", sa.Text(), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("watering_ar", sa.Text(), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("fertilization_ar", sa.Text(), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("greenhouse_guidance_ar", sa.Text(), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("common_pests", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("nutrient_deficiencies", sa.JSON(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "ai_support",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'{\"supported\": false, \"model\": null}'"),
            )
        )

    op.create_index("ix_species_profiles_category", "species_profiles", ["category"])


def downgrade() -> None:
    op.drop_index("ix_species_profiles_category", table_name="species_profiles")
    with op.batch_alter_table("species_profiles") as batch_op:
        for col in (
            "name_ar",
            "name_en",
            "scientific_name",
            "family",
            "category",
            "aliases",
            "image_url",
            "description_ar",
            "watering_ar",
            "fertilization_ar",
            "greenhouse_guidance_ar",
            "common_pests",
            "nutrient_deficiencies",
            "ai_support",
        ):
            batch_op.drop_column(col)
