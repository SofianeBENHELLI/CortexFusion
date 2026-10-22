"""Domain work tasks, immutable transitions, and transactional notification outbox."""

from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
    CREATE TABLE cf_work_tasks (
      tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
      title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 200),
      instructions text NOT NULL CHECK(char_length(instructions) BETWEEN 1 AND 2000),
      criteria text NOT NULL CHECK(char_length(criteria) BETWEEN 1 AND 1000),
      creator text NOT NULL, assignee text,
      status text NOT NULL CHECK(status IN ('unassigned','offered','in_progress','blocked','review','completed','cancelled')),
      revision bigint NOT NULL CHECK(revision>0),
      due_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      offered_at timestamptz, accepted_at timestamptz,
      result_summary text NOT NULL DEFAULT '' CHECK(char_length(result_summary)<=2000),
      PRIMARY KEY(tenant_id,domain_id,id),
      FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id)
    );
    CREATE INDEX work_tasks_assigned ON cf_work_tasks(tenant_id,domain_id,assignee,id);
    CREATE TABLE cf_task_events (
      tenant_id text NOT NULL, domain_id text NOT NULL, task_id text NOT NULL,
      id text NOT NULL, revision bigint NOT NULL, actor text NOT NULL,
      action text NOT NULL, previous_status text NOT NULL, status text NOT NULL,
      assignee text, reason text NOT NULL CHECK(char_length(reason)<=2000),
      result_summary text NOT NULL CHECK(char_length(result_summary)<=2000),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(tenant_id,domain_id,task_id,revision),
      UNIQUE(tenant_id,domain_id,id),
      FOREIGN KEY(tenant_id,domain_id,task_id) REFERENCES cf_work_tasks(tenant_id,domain_id,id)
    );
    CREATE TABLE cf_task_commands (
      tenant_id text NOT NULL, domain_id text NOT NULL, actor text NOT NULL,
      idempotency_key text NOT NULL, request_hash text NOT NULL,
      task_id text NOT NULL, event_id text NOT NULL, revision bigint NOT NULL, status text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(tenant_id,domain_id,actor,idempotency_key),
      FOREIGN KEY(tenant_id,domain_id,event_id) REFERENCES cf_task_events(tenant_id,domain_id,id)
    );
    CREATE TABLE cf_task_outbox (
      tenant_id text NOT NULL, domain_id text NOT NULL, event_id text NOT NULL,
      recipient text NOT NULL, task_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(tenant_id,domain_id,event_id,recipient),
      FOREIGN KEY(tenant_id,domain_id,event_id) REFERENCES cf_task_events(tenant_id,domain_id,id)
    );
    GRANT SELECT,INSERT,UPDATE ON cf_work_tasks TO cortex_app;
    GRANT SELECT,INSERT ON cf_task_events,cf_task_commands,cf_task_outbox TO cortex_app;
    """)
    for table in ("cf_work_tasks", "cf_task_events", "cf_task_commands", "cf_task_outbox"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} USING(tenant_id=current_setting('cortex.tenant',true)) WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
        )
        if table != "cf_work_tasks":
            op.execute(
                f"CREATE TRIGGER immutable_task_record BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION cf_immutable()"
            )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
