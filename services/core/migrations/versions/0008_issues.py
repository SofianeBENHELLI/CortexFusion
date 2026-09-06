"""Private issue lifecycle and immutable decision history."""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE cf_issues ADD COLUMN status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','dismissed')), ADD COLUMN revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0)"
    )
    op.execute("""CREATE TABLE cf_issue_events (
        tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
        issue_id text NOT NULL, author text NOT NULL, previous_status text NOT NULL,
        status text NOT NULL, revision bigint NOT NULL, reason text NOT NULL,
        idempotency_key text NOT NULL, request_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(tenant_id,domain_id,id),
        UNIQUE(tenant_id,domain_id,author,idempotency_key),
        UNIQUE(tenant_id,domain_id,issue_id,revision),
        FOREIGN KEY(tenant_id,domain_id,issue_id) REFERENCES cf_issues(tenant_id,domain_id,id)
    )""")
    op.execute("ALTER TABLE cf_issue_events ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE cf_issue_events FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON cf_issue_events USING(tenant_id=current_setting('cortex.tenant',true)) WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
    )
    op.execute("GRANT SELECT,INSERT ON cf_issue_events TO cortex_app")
    op.execute("GRANT UPDATE(status,revision) ON cf_issues TO cortex_app")
    op.execute(
        "CREATE TRIGGER immutable_issue_event BEFORE UPDATE OR DELETE ON cf_issue_events FOR EACH ROW EXECUTE FUNCTION cf_immutable()"
    )
    op.execute("""CREATE FUNCTION cf_issue_origin_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
        IF (to_jsonb(NEW) - 'status' - 'revision') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'revision')
        THEN RAISE EXCEPTION 'issue origin is immutable'; END IF;
        RETURN NEW;
        END $$""")
    op.execute(
        "CREATE TRIGGER immutable_issue_origin BEFORE UPDATE ON cf_issues FOR EACH ROW EXECUTE FUNCTION cf_issue_origin_immutable()"
    )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
