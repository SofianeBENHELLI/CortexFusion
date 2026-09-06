"""Scoped membership administration with an immutable audit trail."""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE cf_memberships ADD COLUMN revision integer NOT NULL DEFAULT 0")
    op.execute("""CREATE TABLE cf_membership_events (
        tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
        author text NOT NULL, subject text NOT NULL, previous_role text, new_role text,
        resulting_revision integer, reason text NOT NULL, idempotency_key text NOT NULL,
        request_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(tenant_id,domain_id,id), UNIQUE(tenant_id,domain_id,author,idempotency_key),
        FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id)
    )""")
    op.execute("ALTER TABLE cf_membership_events ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE cf_membership_events FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON cf_membership_events USING(tenant_id=current_setting('cortex.tenant',true)) WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
    )
    op.execute("GRANT SELECT,INSERT ON cf_membership_events TO cortex_app")
    op.execute(
        "CREATE TRIGGER immutable_membership_event BEFORE UPDATE OR DELETE ON cf_membership_events FOR EACH ROW EXECUTE FUNCTION cf_immutable()"
    )
    op.execute("GRANT INSERT,DELETE ON cf_memberships TO cortex_app")
    op.execute("GRANT UPDATE(role,revision) ON cf_memberships TO cortex_app")


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
