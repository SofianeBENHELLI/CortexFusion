"""Personal durable synthesis attempts and atomic immutable response outcomes."""

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE cf_synthesis_attempts (
        tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
        subject text NOT NULL, episode_id text NOT NULL,
        provider text NOT NULL CHECK(provider IN ('openrouter','none')),
        requested_model text, prompt_version text NOT NULL,
        budget_reserved boolean NOT NULL, input_sha256 text NOT NULL,
        idempotency_key text NOT NULL, request_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(tenant_id,domain_id,id),
        UNIQUE(tenant_id,domain_id,subject,idempotency_key),
        FOREIGN KEY(tenant_id,domain_id,episode_id) REFERENCES cf_episodes(tenant_id,domain_id,id),
        CHECK((provider='openrouter' AND requested_model IS NOT NULL AND budget_reserved)
            OR (provider='none' AND requested_model IS NULL AND NOT budget_reserved))
    );
    CREATE TABLE cf_synthesis_outcomes (
        tenant_id text NOT NULL, domain_id text NOT NULL, attempt_id text NOT NULL,
        status text NOT NULL CHECK(status IN ('succeeded','failed')),
        response_id text, error_code text, usage jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(tenant_id,domain_id,attempt_id),
        UNIQUE(tenant_id,domain_id,response_id),
        FOREIGN KEY(tenant_id,domain_id,attempt_id) REFERENCES cf_synthesis_attempts(tenant_id,domain_id,id),
        FOREIGN KEY(tenant_id,domain_id,response_id) REFERENCES cf_companion_responses(tenant_id,domain_id,id),
        CHECK((status='succeeded' AND response_id IS NOT NULL AND error_code IS NULL)
            OR (status='failed' AND response_id IS NULL AND error_code IS NOT NULL))
    );
    CREATE INDEX cf_synthesis_day ON cf_synthesis_attempts(tenant_id,domain_id,created_at) WHERE budget_reserved;
    CREATE INDEX cf_synthesis_personal ON cf_synthesis_attempts(tenant_id,domain_id,subject,episode_id,id);
    """)
    for table in ("cf_synthesis_attempts", "cf_synthesis_outcomes"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} USING(tenant_id=current_setting('cortex.tenant',true)) WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
        )
        op.execute(f"GRANT SELECT,INSERT ON {table} TO cortex_app")
        op.execute(
            f"CREATE TRIGGER immutable_synthesis BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION cf_immutable()"
        )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
