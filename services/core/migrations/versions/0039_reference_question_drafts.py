"""Private source-backed reference-question preparation, not an approved bank."""

from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
      CREATE TABLE cf_reference_drafts (
        tenant_id text NOT NULL, domain_id text NOT NULL, author text NOT NULL,
        id text NOT NULL, content jsonb NOT NULL,
        revision bigint NOT NULL CHECK(revision>0),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(tenant_id,domain_id,author,id),
        FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id)
      );
      CREATE TABLE cf_reference_draft_receipts (
        tenant_id text NOT NULL, domain_id text NOT NULL, author text NOT NULL,
        idempotency_key text NOT NULL, id text NOT NULL, question_id text NOT NULL,
        request_hash text NOT NULL CHECK(length(request_hash)=64),
        revision bigint NOT NULL CHECK(revision>0),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(tenant_id,domain_id,author,idempotency_key),
        FOREIGN KEY(tenant_id,domain_id,author,question_id)
          REFERENCES cf_reference_drafts(tenant_id,domain_id,author,id)
      );
      GRANT SELECT,INSERT,UPDATE ON cf_reference_drafts TO cortex_app;
      GRANT SELECT,INSERT ON cf_reference_draft_receipts TO cortex_app;
      CREATE TRIGGER immutable_reference_draft_receipt BEFORE UPDATE OR DELETE
        ON cf_reference_draft_receipts FOR EACH ROW EXECUTE FUNCTION cf_immutable();
    """)
    for table in ("cf_reference_drafts", "cf_reference_draft_receipts"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} USING(tenant_id=current_setting('cortex.tenant',true)) WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
        )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
