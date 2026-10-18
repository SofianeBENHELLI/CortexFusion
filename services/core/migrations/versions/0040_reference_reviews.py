"""Named review of an immutable private-reference snapshot; no official approval."""

from alembic import op

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
    CREATE TABLE cf_reference_review_preparations (
      tenant_id text NOT NULL, domain_id text NOT NULL, author text NOT NULL,
      id text NOT NULL, payload_hash text NOT NULL, membership_revision bigint NOT NULL,
      expires_at timestamptz NOT NULL DEFAULT(clock_timestamp()+interval '5 minutes'),
      PRIMARY KEY(tenant_id,domain_id,author,id),
      FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id)
    );
    CREATE TABLE cf_reference_reviews (
      tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
      author text NOT NULL, reviewer text NOT NULL CHECK(author<>reviewer),
      question_id text NOT NULL, draft_revision bigint NOT NULL CHECK(draft_revision>0),
      content jsonb NOT NULL, preparation_id text NOT NULL,
      status text NOT NULL CHECK(status IN ('awaiting_review','changes_requested','ready_for_owner','withdrawn')),
      revision bigint NOT NULL CHECK(revision>0), review_note text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(tenant_id,domain_id,id),
      UNIQUE(tenant_id,domain_id,author,question_id,draft_revision),
      FOREIGN KEY(tenant_id,domain_id,author,preparation_id)
        REFERENCES cf_reference_review_preparations(tenant_id,domain_id,author,id),
      FOREIGN KEY(tenant_id,domain_id,author,question_id)
        REFERENCES cf_reference_drafts(tenant_id,domain_id,author,id)
    );
    CREATE TABLE cf_reference_review_commands (
      tenant_id text NOT NULL, domain_id text NOT NULL, actor text NOT NULL,
      idempotency_key text NOT NULL, request_hash text NOT NULL, review_id text NOT NULL,
      event_id text NOT NULL, action text NOT NULL, revision bigint NOT NULL,
      status text NOT NULL, note text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(tenant_id,domain_id,actor,idempotency_key),
      UNIQUE(tenant_id,domain_id,review_id,revision),
      FOREIGN KEY(tenant_id,domain_id,review_id) REFERENCES cf_reference_reviews(tenant_id,domain_id,id)
    );
    CREATE FUNCTION cf_reference_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF ROW(NEW.tenant_id,NEW.domain_id,NEW.id,NEW.author,NEW.reviewer,NEW.question_id,NEW.draft_revision,NEW.content,NEW.preparation_id,NEW.created_at)
        IS DISTINCT FROM ROW(OLD.tenant_id,OLD.domain_id,OLD.id,OLD.author,OLD.reviewer,OLD.question_id,OLD.draft_revision,OLD.content,OLD.preparation_id,OLD.created_at)
      THEN RAISE EXCEPTION 'reference snapshot is immutable'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER immutable_reference_snapshot BEFORE UPDATE ON cf_reference_reviews
      FOR EACH ROW EXECUTE FUNCTION cf_reference_snapshot_immutable();
    GRANT SELECT,INSERT ON cf_reference_review_preparations,cf_reference_review_commands TO cortex_app;
    GRANT SELECT,INSERT,UPDATE ON cf_reference_reviews TO cortex_app;
    """)
    for table in (
        "cf_reference_review_preparations",
        "cf_reference_reviews",
        "cf_reference_review_commands",
    ):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} USING(tenant_id=current_setting('cortex.tenant',true)) WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
        )
        if table != "cf_reference_reviews":
            op.execute(
                f"CREATE TRIGGER immutable_reference_review_record BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION cf_immutable()"
            )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
