"""Capture effective source-access transitions atomically, including older writers."""

from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("LOCK TABLE cf_sources IN SHARE ROW EXCLUSIVE MODE")
    op.execute("""
    CREATE TABLE cf_source_access_events (
        tenant_id text NOT NULL, domain_id text NOT NULL, source_id text NOT NULL,
        id text NOT NULL DEFAULT gen_random_uuid()::text,
        ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
        actor text CHECK(actor IS NULL OR (length(actor) BETWEEN 1 AND 300)),
        actor_source text NOT NULL CHECK(actor_source IN ('runtime_context','unattributed')),
        previous_allowed_subjects jsonb NOT NULL,
        allowed_subjects jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(tenant_id,domain_id,id),
        FOREIGN KEY(tenant_id,domain_id,source_id) REFERENCES cf_sources(tenant_id,domain_id,id),
        CHECK((actor IS NULL) = (actor_source='unattributed'))
    );
    CREATE INDEX source_access_history ON cf_source_access_events(tenant_id,domain_id,source_id,ordinal);
    ALTER TABLE cf_source_access_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE cf_source_access_events FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON cf_source_access_events
        USING(tenant_id=current_setting('cortex.tenant',true))
        WITH CHECK(tenant_id=current_setting('cortex.tenant',true));
    GRANT SELECT ON cf_source_access_events TO cortex_app;
    CREATE TRIGGER immutable_source_access_event BEFORE UPDATE OR DELETE ON cf_source_access_events
        FOR EACH ROW EXECUTE FUNCTION cf_immutable();

    CREATE FUNCTION cf_capture_source_access() RETURNS trigger
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    DECLARE actor text;
    BEGIN
        -- ACLs are sets: ordering and duplicate removal alone do not change access.
        IF OLD.allowed_subjects @> NEW.allowed_subjects
           AND NEW.allowed_subjects @> OLD.allowed_subjects THEN RETURN NEW; END IF;
        actor := NULLIF(current_setting('cortex.source_access_actor',true),'');
        INSERT INTO public.cf_source_access_events(
            tenant_id,domain_id,source_id,actor,actor_source,
            previous_allowed_subjects,allowed_subjects
        ) VALUES(
            NEW.tenant_id,NEW.domain_id,NEW.id,actor,
            CASE WHEN actor IS NULL THEN 'unattributed' ELSE 'runtime_context' END,
            OLD.allowed_subjects,NEW.allowed_subjects
        );
        RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION cf_capture_source_access() FROM PUBLIC;
    CREATE TRIGGER capture_source_access AFTER UPDATE OF allowed_subjects ON cf_sources
        FOR EACH ROW EXECUTE FUNCTION cf_capture_source_access();
    """)


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
