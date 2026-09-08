"""Optional evidence-governed correction references on immutable personal decisions."""

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""ALTER TABLE cf_issue_events
        ADD COLUMN correction_proposal_id text,
        ADD COLUMN correction_digest text,
        ADD COLUMN correction_published_version bigint,
        ADD CONSTRAINT cf_issue_correction_fk FOREIGN KEY(tenant_id,domain_id,correction_proposal_id)
            REFERENCES cf_proposals(tenant_id,domain_id,id),
        ADD CONSTRAINT cf_issue_correction_shape CHECK(
            (correction_proposal_id IS NULL AND correction_digest IS NULL AND correction_published_version IS NULL)
            OR (correction_proposal_id IS NOT NULL AND correction_digest IS NOT NULL
                AND correction_digest ~ '^[a-f0-9]{64}$'
                AND status IN ('in_progress','resolved')
                AND (correction_published_version IS NULL OR correction_published_version > 0)
                AND (status <> 'resolved' OR correction_published_version IS NOT NULL))
        )""")


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
