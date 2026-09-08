"""Index personal episode and issue selection before application evidence checks."""

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "CREATE INDEX cf_episode_personal_page ON cf_episodes(tenant_id,domain_id,subject,id)"
    )
    op.execute("CREATE INDEX cf_issue_episode_page ON cf_issues(tenant_id,domain_id,episode_id,id)")


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
