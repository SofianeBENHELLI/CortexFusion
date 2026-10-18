"""Retain the precise task target in future immutable case association events."""

from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
    ALTER TABLE cf_case_events ADD COLUMN task_id text;
    ALTER TABLE cf_case_events ADD CONSTRAINT case_event_task_target
      FOREIGN KEY(tenant_id,domain_id,task_id) REFERENCES cf_work_tasks(tenant_id,domain_id,id);
    """)


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
