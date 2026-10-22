"""Explicit named excerpt sharing; personal origins never become team references."""

from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
    CREATE TABLE cf_case_preparations (
      tenant_id text NOT NULL, domain_id text NOT NULL, subject text NOT NULL, id text NOT NULL,
      payload_hash text NOT NULL, membership_revision bigint NOT NULL,
      expires_at timestamptz NOT NULL DEFAULT(clock_timestamp()+interval '5 minutes'),
      PRIMARY KEY(tenant_id,domain_id,subject,id),
      FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id)
    );
    CREATE TABLE cf_shared_cases (
      tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL, author text NOT NULL,
      title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 200),
      excerpt text NOT NULL CHECK(char_length(excerpt) BETWEEN 1 AND 2000),
      target text NOT NULL CHECK(target IN ('retrieved_evidence','delivered_answer','client_behavior')),
      origin text NOT NULL CHECK(origin IN ('explicit','observed','inferred')),
      personal_signal_id text, recipients jsonb NOT NULL CHECK(jsonb_typeof(recipients)='array'),
      policy_version text NOT NULL CHECK(policy_version='named-excerpt-v1'),
      status text NOT NULL CHECK(status IN ('new','qualified','closed_without_change','withdrawn')),
      qualification text NOT NULL DEFAULT 'unclassified',
      public_conclusion text NOT NULL DEFAULT '' CHECK(char_length(public_conclusion)<=2000),
      revision bigint NOT NULL CHECK(revision>0),
      preparation_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), withdrawn_at timestamptz,
      PRIMARY KEY(tenant_id,domain_id,id),
      UNIQUE(tenant_id,domain_id,author,preparation_id),
      FOREIGN KEY(tenant_id,domain_id,author,preparation_id)
        REFERENCES cf_case_preparations(tenant_id,domain_id,subject,id)
    );
    CREATE INDEX case_chronology ON cf_shared_cases(tenant_id,domain_id,created_at,id);
    CREATE INDEX case_author_chronology ON cf_shared_cases(tenant_id,domain_id,author,created_at,id);
    CREATE TABLE cf_case_events (
      tenant_id text NOT NULL, domain_id text NOT NULL, case_id text NOT NULL, id text NOT NULL,
      actor text NOT NULL, action text NOT NULL, revision bigint NOT NULL, status text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(tenant_id,domain_id,id), UNIQUE(tenant_id,domain_id,case_id,revision),
      FOREIGN KEY(tenant_id,domain_id,case_id) REFERENCES cf_shared_cases(tenant_id,domain_id,id)
    );
    CREATE TABLE cf_case_commands (
      tenant_id text NOT NULL, domain_id text NOT NULL, actor text NOT NULL, idempotency_key text NOT NULL,
      request_hash text NOT NULL, case_id text NOT NULL, event_id text NOT NULL,
      revision bigint NOT NULL, status text NOT NULL,
      PRIMARY KEY(tenant_id,domain_id,actor,idempotency_key),
      FOREIGN KEY(tenant_id,domain_id,event_id) REFERENCES cf_case_events(tenant_id,domain_id,id)
    );
    GRANT SELECT,INSERT ON cf_case_preparations,cf_case_events,cf_case_commands TO cortex_app;
    GRANT SELECT,INSERT,UPDATE ON cf_shared_cases TO cortex_app;
    CREATE TRIGGER workspace_case_revision AFTER INSERT OR UPDATE OR DELETE ON cf_shared_cases
      FOR EACH ROW EXECUTE FUNCTION cf_workspace_revision();
    """)
    for table in ("cf_case_preparations", "cf_shared_cases", "cf_case_events", "cf_case_commands"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} USING(tenant_id=current_setting('cortex.tenant',true)) WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
        )
        if table != "cf_shared_cases":
            op.execute(
                f"CREATE TRIGGER immutable_case_record BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION cf_immutable()"
            )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
