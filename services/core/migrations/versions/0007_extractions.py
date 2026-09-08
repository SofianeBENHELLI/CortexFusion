"""Immutable receipts for opt-in local passage extraction."""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE cf_extractions (
        tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
        author text NOT NULL, source_id text NOT NULL, proposal_id text NOT NULL,
        model_metadata jsonb NOT NULL, idempotency_key text NOT NULL, request_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(tenant_id,domain_id,id), UNIQUE(tenant_id,domain_id,author,idempotency_key),
        FOREIGN KEY(tenant_id,domain_id,source_id) REFERENCES cf_sources(tenant_id,domain_id,id),
        FOREIGN KEY(tenant_id,domain_id,proposal_id) REFERENCES cf_proposals(tenant_id,domain_id,id)
    )""")
    op.execute("ALTER TABLE cf_extractions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE cf_extractions FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON cf_extractions USING(tenant_id=current_setting('cortex.tenant',true)) WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
    )
    op.execute("GRANT SELECT,INSERT ON cf_extractions TO cortex_app")
    op.execute(
        "CREATE TRIGGER immutable_extraction BEFORE UPDATE OR DELETE ON cf_extractions FOR EACH ROW EXECUTE FUNCTION cf_immutable()"
    )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
