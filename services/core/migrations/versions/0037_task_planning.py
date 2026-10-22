"""Explicit task priority and revised deadlines with immutable before/after evidence."""

from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
    ALTER TABLE cf_work_tasks ADD COLUMN priority text NOT NULL DEFAULT 'normal'
      CHECK(priority IN ('low','normal','high'));
    ALTER TABLE cf_work_tasks ADD COLUMN priority_reason text NOT NULL DEFAULT ''
      CHECK(char_length(priority_reason)<=2000);
    ALTER TABLE cf_task_events ADD COLUMN planning jsonb;
    """)


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
