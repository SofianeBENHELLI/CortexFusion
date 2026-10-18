"""Personal source contribution drafts; immutable content-free save receipts."""

from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
      CREATE TABLE cf_contribution_drafts (
        tenant_id text NOT NULL, domain_id text NOT NULL, author text NOT NULL,
        content jsonb, revision bigint NOT NULL CHECK(revision>0),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(tenant_id,domain_id,author),
        FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id),
        CHECK(content IS NULL OR (jsonb_typeof(content)='object'
          AND char_length(content->>'title')<=200
          AND char_length(content->>'excerpt')<=200000
          AND char_length(content->>'reason')<=2000))
      );
      CREATE TABLE cf_contribution_draft_receipts (
        tenant_id text NOT NULL, domain_id text NOT NULL, author text NOT NULL,
        idempotency_key text NOT NULL, id text NOT NULL,
        request_hash text NOT NULL CHECK(length(request_hash)=64),
        revision bigint NOT NULL CHECK(revision>0),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(tenant_id,domain_id,author,idempotency_key),
        FOREIGN KEY(tenant_id,domain_id,author)
          REFERENCES cf_contribution_drafts(tenant_id,domain_id,author)
      );
      GRANT SELECT,INSERT,UPDATE ON cf_contribution_drafts TO cortex_app;
      GRANT SELECT,INSERT ON cf_contribution_draft_receipts TO cortex_app;
      CREATE TRIGGER immutable_contribution_draft_receipt
        BEFORE UPDATE OR DELETE ON cf_contribution_draft_receipts
        FOR EACH ROW EXECUTE FUNCTION cf_immutable();
    """)
    for table in ("cf_contribution_drafts", "cf_contribution_draft_receipts"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            "USING(tenant_id=current_setting('cortex.tenant',true)) "
            "WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
        )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
