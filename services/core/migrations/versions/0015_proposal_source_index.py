"""Index evidence-source lookup for import-to-proposal navigation."""

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "CREATE INDEX cf_proposal_evidence_sources ON cf_proposals USING gin ((validation->'source_ids') jsonb_path_ops)"
    )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
