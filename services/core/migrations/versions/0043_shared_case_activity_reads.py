"""Extend personal reading markers to explicitly shared case events."""

from alembic import op

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
    ALTER TABLE cf_work_activity_reads DROP CONSTRAINT cf_work_activity_reads_kind_check;
    ALTER TABLE cf_work_activity_reads ADD CONSTRAINT cf_work_activity_reads_kind_check
      CHECK(kind IN ('reference_review','mission','shared_case'));
    """)


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
