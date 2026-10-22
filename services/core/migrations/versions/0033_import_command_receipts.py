"""Immutable receipts for snapshot-bound personal import commands."""

from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
      CREATE TABLE cf_import_commands (
        tenant_id text NOT NULL, domain_id text NOT NULL, import_id text NOT NULL,
        actor text NOT NULL, idempotency_key text NOT NULL, request_hash text NOT NULL,
        receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(tenant_id,domain_id,import_id,actor,idempotency_key),
        FOREIGN KEY(tenant_id,domain_id,import_id) REFERENCES cf_imports(tenant_id,domain_id,id)
      );
      ALTER TABLE cf_import_commands ENABLE ROW LEVEL SECURITY;
      ALTER TABLE cf_import_commands FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON cf_import_commands
        USING(tenant_id=current_setting('cortex.tenant',true))
        WITH CHECK(tenant_id=current_setting('cortex.tenant',true));
      CREATE TRIGGER immutable_import_command BEFORE UPDATE OR DELETE ON cf_import_commands
        FOR EACH ROW EXECUTE FUNCTION cf_immutable();
      GRANT SELECT,INSERT ON cf_import_commands TO cortex_app;
    """)


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
