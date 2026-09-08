"""Single-use trusted-host confirmation ledger."""

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE cf_mcp_confirmations (
        tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
        subject text NOT NULL, action text NOT NULL, command_hash text NOT NULL,
        consumed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(tenant_id,id),
        FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id)
    )""")
    op.execute("ALTER TABLE cf_mcp_confirmations ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE cf_mcp_confirmations FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON cf_mcp_confirmations USING(tenant_id=current_setting('cortex.tenant',true)) WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
    )
    op.execute("GRANT SELECT,INSERT ON cf_mcp_confirmations TO cortex_app")
    op.execute(
        "CREATE TRIGGER immutable_confirmation BEFORE UPDATE OR DELETE ON cf_mcp_confirmations FOR EACH ROW EXECUTE FUNCTION cf_immutable()"
    )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
