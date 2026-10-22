"""Explicit reversible case/task references without content or access transfer."""

from alembic import op

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
    CREATE TABLE cf_case_tasks (
      tenant_id text NOT NULL, domain_id text NOT NULL, case_id text NOT NULL,
      task_id text NOT NULL, active boolean NOT NULL, event_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(tenant_id,domain_id,case_id,task_id),
      FOREIGN KEY(tenant_id,domain_id,case_id) REFERENCES cf_shared_cases(tenant_id,domain_id,id),
      FOREIGN KEY(tenant_id,domain_id,task_id) REFERENCES cf_work_tasks(tenant_id,domain_id,id),
      FOREIGN KEY(tenant_id,domain_id,event_id) REFERENCES cf_case_events(tenant_id,domain_id,id)
    );
    GRANT SELECT,INSERT,UPDATE ON cf_case_tasks TO cortex_app;
    ALTER TABLE cf_case_tasks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE cf_case_tasks FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON cf_case_tasks
      USING(tenant_id=current_setting('cortex.tenant',true))
      WITH CHECK(tenant_id=current_setting('cortex.tenant',true));
    """)


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
