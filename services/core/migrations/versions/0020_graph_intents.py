"""Persist expected snapshot identity before engine IO for read-only reconciliation."""

from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE cf_graph_preparations ADD COLUMN intent jsonb CHECK(intent IS NULL OR jsonb_typeof(intent)='object')"
    )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
