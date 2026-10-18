"""Explicit proposal references and non-binding expert opinions, separate from owner decisions."""

from alembic import op

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
    CREATE TABLE cf_task_proposals (
      tenant_id text NOT NULL, domain_id text NOT NULL, task_id text NOT NULL,
      proposal_id text NOT NULL, actor text NOT NULL, event_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(tenant_id,domain_id,task_id,proposal_id),
      FOREIGN KEY(tenant_id,domain_id,task_id) REFERENCES cf_work_tasks(tenant_id,domain_id,id),
      FOREIGN KEY(tenant_id,domain_id,proposal_id) REFERENCES cf_proposals(tenant_id,domain_id,id),
      FOREIGN KEY(tenant_id,domain_id,event_id) REFERENCES cf_task_events(tenant_id,domain_id,id)
    );
    CREATE TABLE cf_expert_reviews (
      tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
      task_id text NOT NULL, proposal_id text NOT NULL, author text NOT NULL,
      proposal_digest text NOT NULL, proposal_review_revision integer NOT NULL,
      task_revision bigint NOT NULL, event_id text NOT NULL,
      opinion text NOT NULL CHECK(opinion IN ('supports','changes_requested','insufficient_evidence')),
      justification text NOT NULL CHECK(char_length(justification) BETWEEN 1 AND 2000),
      evidence_source_ids jsonb NOT NULL CHECK(jsonb_typeof(evidence_source_ids)='array'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(tenant_id,domain_id,id), UNIQUE(tenant_id,domain_id,event_id),
      FOREIGN KEY(tenant_id,domain_id,task_id,proposal_id) REFERENCES cf_task_proposals(tenant_id,domain_id,task_id,proposal_id),
      FOREIGN KEY(tenant_id,domain_id,event_id) REFERENCES cf_task_events(tenant_id,domain_id,id)
    );
    CREATE INDEX expert_review_chronology ON cf_expert_reviews(tenant_id,domain_id,task_id,proposal_id,created_at,id);
    GRANT SELECT,INSERT ON cf_task_proposals,cf_expert_reviews TO cortex_app;
    """)
    for table in ("cf_task_proposals", "cf_expert_reviews"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} USING(tenant_id=current_setting('cortex.tenant',true)) WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
        )
        op.execute(
            f"CREATE TRIGGER immutable_expert_record BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION cf_immutable()"
        )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
