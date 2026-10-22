"""Personal read markers for reference reviews and mission events, no business transition."""

from alembic import op

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
    CREATE TABLE cf_work_activity_reads (
      tenant_id text NOT NULL, domain_id text NOT NULL, subject text NOT NULL,
      kind text NOT NULL CHECK(kind IN ('reference_review','mission')),
      event_id text NOT NULL, idempotency_key text NOT NULL,
      read_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(tenant_id,domain_id,subject,kind,event_id),
      UNIQUE(tenant_id,domain_id,subject,idempotency_key),
      FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id)
    );
    ALTER TABLE cf_work_activity_reads ENABLE ROW LEVEL SECURITY;
    ALTER TABLE cf_work_activity_reads FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON cf_work_activity_reads
      USING(tenant_id=current_setting('cortex.tenant',true))
      WITH CHECK(tenant_id=current_setting('cortex.tenant',true));
    GRANT SELECT,INSERT ON cf_work_activity_reads TO cortex_app;
    CREATE TRIGGER immutable_work_activity_read BEFORE UPDATE OR DELETE ON cf_work_activity_reads
      FOR EACH ROW EXECUTE FUNCTION cf_immutable();
    CREATE INDEX source_access_domain_ordinal ON cf_source_access_events(tenant_id,domain_id,ordinal);
    """)


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
