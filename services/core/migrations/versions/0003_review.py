"""Review revisions and immutable decision receipts."""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE cf_proposals DROP CONSTRAINT cf_proposals_status_check")
    op.execute(
        "ALTER TABLE cf_proposals ADD CHECK(status IN ('ready','approved','published','rejected','deferred','changes_requested','superseded'))"
    )
    op.execute("ALTER TABLE cf_proposals ADD COLUMN review_revision integer NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE cf_proposals ADD COLUMN replaces_id text")
    op.execute(
        "ALTER TABLE cf_proposals ADD FOREIGN KEY(tenant_id,domain_id,replaces_id) REFERENCES cf_proposals(tenant_id,domain_id,id)"
    )
    op.execute("""CREATE TABLE cf_reviews (
        tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
        proposal_id text NOT NULL, author text NOT NULL, action text NOT NULL,
        reason text NOT NULL, proposal_digest text NOT NULL, review_revision integer NOT NULL,
        resulting_status text NOT NULL, idempotency_key text NOT NULL, request_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(tenant_id,domain_id,id),
        UNIQUE(tenant_id,domain_id,author,idempotency_key),
        FOREIGN KEY(tenant_id,domain_id,proposal_id) REFERENCES cf_proposals(tenant_id,domain_id,id)
    )""")
    op.execute("ALTER TABLE cf_reviews ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE cf_reviews FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON cf_reviews USING(tenant_id=current_setting('cortex.tenant',true)) WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
    )
    op.execute("GRANT SELECT,INSERT ON cf_reviews TO cortex_app")
    op.execute(
        "CREATE TRIGGER immutable_review BEFORE UPDATE OR DELETE ON cf_reviews FOR EACH ROW EXECUTE FUNCTION cf_immutable()"
    )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
