"""Personal external-companion response receipts and precise feedback associations."""

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE cf_companion_responses (
        tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
        subject text NOT NULL, episode_id text NOT NULL, payload jsonb NOT NULL,
        idempotency_key text NOT NULL, request_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(tenant_id,domain_id,id),
        UNIQUE(tenant_id,domain_id,subject,idempotency_key),
        FOREIGN KEY(tenant_id,domain_id,episode_id) REFERENCES cf_episodes(tenant_id,domain_id,id)
    );
    ALTER TABLE cf_companion_responses ENABLE ROW LEVEL SECURITY;
    ALTER TABLE cf_companion_responses FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON cf_companion_responses
        USING(tenant_id=current_setting('cortex.tenant',true))
        WITH CHECK(tenant_id=current_setting('cortex.tenant',true));
    GRANT SELECT,INSERT ON cf_companion_responses TO cortex_app;
    CREATE TRIGGER immutable_companion_response BEFORE UPDATE OR DELETE ON cf_companion_responses
        FOR EACH ROW EXECUTE FUNCTION cf_immutable();
    ALTER TABLE cf_feedback_signals ADD COLUMN companion_response_id text;
    ALTER TABLE cf_feedback_signals ADD CONSTRAINT cf_signal_response_fk
        FOREIGN KEY(tenant_id,domain_id,companion_response_id) REFERENCES cf_companion_responses(tenant_id,domain_id,id);
    CREATE INDEX cf_companion_response_episode ON cf_companion_responses(tenant_id,domain_id,subject,episode_id,id)
    """)


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
