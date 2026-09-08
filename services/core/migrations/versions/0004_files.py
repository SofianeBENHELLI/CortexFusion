"""Private binary uploads and recoverable parsing leases."""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE cf_files (
        tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
        collection_id text NOT NULL, author text NOT NULL, filename text NOT NULL,
        content_hash text NOT NULL, data bytea NOT NULL, allowed_subjects jsonb NOT NULL,
        status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','succeeded','failed','cancelled')),
        source_id text, spans jsonb NOT NULL DEFAULT '[]', error_code text,
        attempts integer NOT NULL DEFAULT 0, lease_token text, lease_until timestamptz,
        idempotency_key text NOT NULL, request_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(tenant_id,domain_id,id),
        UNIQUE(tenant_id,domain_id,author,idempotency_key),
        FOREIGN KEY(tenant_id,domain_id,collection_id) REFERENCES cf_collections(tenant_id,domain_id,id),
        FOREIGN KEY(tenant_id,domain_id,source_id) REFERENCES cf_sources(tenant_id,domain_id,id),
        CHECK(octet_length(data)<=500000),
        CHECK((status='succeeded')=(source_id IS NOT NULL))
    )""")
    op.execute("ALTER TABLE cf_files ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE cf_files FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON cf_files USING(tenant_id=current_setting('cortex.tenant',true)) WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
    )
    op.execute("GRANT SELECT,INSERT ON cf_files TO cortex_app")
    op.execute(
        "GRANT UPDATE(status,source_id,spans,error_code,attempts,lease_token,lease_until) ON cf_files TO cortex_app"
    )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
