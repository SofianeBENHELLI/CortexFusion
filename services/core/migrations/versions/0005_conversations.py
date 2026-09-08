"""Personal conversations and idempotent episode associations."""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE cf_conversations (
        tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
        author text NOT NULL, title text NOT NULL, archived boolean NOT NULL DEFAULT false,
        revision integer NOT NULL DEFAULT 0, idempotency_key text NOT NULL, request_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(tenant_id,domain_id,id), UNIQUE(tenant_id,domain_id,author,idempotency_key),
        FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id)
    );
    CREATE TABLE cf_conversation_episodes (
        tenant_id text NOT NULL, domain_id text NOT NULL, conversation_id text NOT NULL,
        episode_id text NOT NULL, sequence integer NOT NULL, idempotency_key text NOT NULL, request_hash text NOT NULL,
        PRIMARY KEY(tenant_id,domain_id,conversation_id,sequence),
        UNIQUE(tenant_id,domain_id,conversation_id,idempotency_key),
        FOREIGN KEY(tenant_id,domain_id,conversation_id) REFERENCES cf_conversations(tenant_id,domain_id,id),
        FOREIGN KEY(tenant_id,domain_id,episode_id) REFERENCES cf_episodes(tenant_id,domain_id,id)
    )""")
    for table in ("cf_conversations", "cf_conversation_episodes"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} USING(tenant_id=current_setting('cortex.tenant',true)) WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
        )
        op.execute(f"GRANT SELECT,INSERT ON {table} TO cortex_app")
    op.execute("GRANT UPDATE(title,archived,revision) ON cf_conversations TO cortex_app")
    op.execute(
        "CREATE TRIGGER immutable_conversation_episode BEFORE UPDATE OR DELETE ON cf_conversation_episodes FOR EACH ROW EXECUTE FUNCTION cf_immutable()"
    )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
