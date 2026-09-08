"""Personal feedback collection preferences and immutable provenance-aware signals."""

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE cf_feedback_preferences (
        tenant_id text NOT NULL, domain_id text NOT NULL, subject text NOT NULL,
        allow_observed boolean NOT NULL DEFAULT false,
        allow_inferred boolean NOT NULL DEFAULT false,
        revision bigint NOT NULL DEFAULT 0,
        PRIMARY KEY(tenant_id,domain_id,subject),
        FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id)
    )""")
    op.execute("""CREATE TABLE cf_feedback_signals (
        tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
        subject text NOT NULL, episode_id text NOT NULL, origin text NOT NULL,
        kind text NOT NULL, payload jsonb NOT NULL, idempotency_key text NOT NULL,
        request_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(tenant_id,domain_id,id),
        UNIQUE(tenant_id,domain_id,subject,idempotency_key),
        FOREIGN KEY(tenant_id,domain_id,episode_id) REFERENCES cf_episodes(tenant_id,domain_id,id)
    )""")
    for table in ("cf_feedback_preferences", "cf_feedback_signals"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} USING(tenant_id=current_setting('cortex.tenant',true)) WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
        )
        op.execute(f"GRANT SELECT,INSERT ON {table} TO cortex_app")
    op.execute(
        "GRANT UPDATE(allow_observed,allow_inferred,revision) ON cf_feedback_preferences TO cortex_app"
    )
    op.execute(
        "CREATE TRIGGER immutable_feedback_signal BEFORE UPDATE OR DELETE ON cf_feedback_signals FOR EACH ROW EXECUTE FUNCTION cf_immutable()"
    )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
