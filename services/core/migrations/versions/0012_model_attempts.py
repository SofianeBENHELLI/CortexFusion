"""Durable model call reservations and immutable outcomes, separate from accepted extractions."""

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE cf_model_attempts (
        tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
        author text NOT NULL, source_id text NOT NULL, provider text NOT NULL,
        requested_model text NOT NULL, input_span jsonb NOT NULL, input_sha256 text NOT NULL,
        idempotency_key text NOT NULL, request_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(tenant_id,domain_id,id),
        UNIQUE(tenant_id,domain_id,author,idempotency_key),
        FOREIGN KEY(tenant_id,domain_id,source_id) REFERENCES cf_sources(tenant_id,domain_id,id)
    );
    CREATE TABLE cf_model_outcomes (
        tenant_id text NOT NULL, domain_id text NOT NULL, attempt_id text NOT NULL,
        status text NOT NULL CHECK(status IN ('succeeded','failed')),
        error_code text, extraction_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(tenant_id,domain_id,attempt_id),
        FOREIGN KEY(tenant_id,domain_id,attempt_id) REFERENCES cf_model_attempts(tenant_id,domain_id,id),
        FOREIGN KEY(tenant_id,domain_id,extraction_id) REFERENCES cf_extractions(tenant_id,domain_id,id),
        CHECK((status='succeeded' AND extraction_id IS NOT NULL AND error_code IS NULL)
           OR (status='failed' AND extraction_id IS NULL AND error_code IS NOT NULL))
    );
    CREATE INDEX cf_model_attempt_day ON cf_model_attempts(tenant_id,domain_id,created_at)
    """)
    for table in ("cf_model_attempts", "cf_model_outcomes"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} USING(tenant_id=current_setting('cortex.tenant',true)) WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
        )
        op.execute(f"GRANT SELECT,INSERT ON {table} TO cortex_app")
        op.execute(
            f"CREATE TRIGGER immutable_model_record BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION cf_immutable()"
        )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
