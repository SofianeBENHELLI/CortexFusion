"""Index authorized expert history by proposal without copying review content."""

from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
      CREATE INDEX cf_expert_reviews_proposal_history
      ON cf_expert_reviews(tenant_id,domain_id,proposal_id,created_at,id)
    """)


def downgrade():
    op.execute("DROP INDEX cf_expert_reviews_proposal_history")
