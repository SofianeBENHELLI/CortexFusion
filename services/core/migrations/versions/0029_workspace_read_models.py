"""Versioned workspace pagination and personal task notification acknowledgements."""

from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
    ALTER TABLE cf_domains ADD COLUMN work_revision bigint NOT NULL DEFAULT 0;
    ALTER TABLE cf_domains ADD COLUMN membership_revision bigint NOT NULL DEFAULT 0;
    CREATE FUNCTION cf_workspace_revision() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE t text; d text;
    BEGIN
      IF TG_OP='DELETE' THEN t=OLD.tenant_id; d=OLD.domain_id;
      ELSE t=NEW.tenant_id; d=NEW.domain_id; END IF;
      IF TG_TABLE_NAME='cf_memberships' THEN
        UPDATE cf_domains SET membership_revision=membership_revision+1 WHERE tenant_id=t AND id=d;
      ELSE
        UPDATE cf_domains SET work_revision=work_revision+1 WHERE tenant_id=t AND id=d;
      END IF;
      RETURN NULL;
    END $$;
    CREATE TRIGGER workspace_membership_revision AFTER INSERT OR UPDATE OR DELETE ON cf_memberships
      FOR EACH ROW EXECUTE FUNCTION cf_workspace_revision();
    CREATE TRIGGER workspace_task_revision AFTER INSERT OR UPDATE OR DELETE ON cf_work_tasks
      FOR EACH ROW EXECUTE FUNCTION cf_workspace_revision();
    CREATE INDEX work_tasks_chronology ON cf_work_tasks(tenant_id,domain_id,created_at,id);
    CREATE INDEX work_tasks_assignee_chronology ON cf_work_tasks(tenant_id,domain_id,assignee,created_at,id);
    CREATE INDEX task_notifications_chronology ON cf_task_outbox(tenant_id,domain_id,recipient,created_at,event_id);
    CREATE TABLE cf_workspace_cursors (
      tenant_id text NOT NULL, domain_id text NOT NULL, subject text NOT NULL,
      id text NOT NULL, kind text NOT NULL, fingerprint text NOT NULL,
      position jsonb NOT NULL, work_revision bigint NOT NULL, membership_revision bigint NOT NULL,
      as_of timestamptz NOT NULL, expires_at timestamptz NOT NULL,
      PRIMARY KEY(tenant_id,domain_id,subject,id),
      FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id)
    );
    CREATE TABLE cf_task_notification_reads (
      tenant_id text NOT NULL, domain_id text NOT NULL, subject text NOT NULL,
      event_id text NOT NULL, idempotency_key text NOT NULL,
      read_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(tenant_id,domain_id,subject,event_id),
      UNIQUE(tenant_id,domain_id,subject,idempotency_key),
      FOREIGN KEY(tenant_id,domain_id,event_id,subject)
        REFERENCES cf_task_outbox(tenant_id,domain_id,event_id,recipient)
    );
    GRANT SELECT,INSERT ON cf_workspace_cursors,cf_task_notification_reads TO cortex_app;
    """)
    for table in ("cf_workspace_cursors", "cf_task_notification_reads"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} USING(tenant_id=current_setting('cortex.tenant',true)) WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
        )
        op.execute(
            f"CREATE TRIGGER immutable_workspace_read BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION cf_immutable()"
        )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
