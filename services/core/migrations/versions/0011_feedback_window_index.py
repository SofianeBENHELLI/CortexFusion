"""Index bounded personal feedback windows and episode conversation lookup."""

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "CREATE INDEX cf_feedback_signal_window ON cf_feedback_signals(tenant_id,domain_id,subject,created_at,id)"
    )
    op.execute(
        "CREATE INDEX cf_conversation_episode_lookup ON cf_conversation_episodes(tenant_id,domain_id,episode_id,conversation_id)"
    )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
