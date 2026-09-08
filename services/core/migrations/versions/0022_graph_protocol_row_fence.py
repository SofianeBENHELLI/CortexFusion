"""Fence publishers whose repeatable-read snapshot predates graph enrollment."""

from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL row_security=off")
    op.execute("""
    LOCK TABLE cf_domains,cf_graph_protocols IN ACCESS EXCLUSIVE MODE;
    ALTER TABLE cf_domains ADD COLUMN graph_protocol integer NOT NULL DEFAULT 1
        CHECK(graph_protocol IN (1,2));
    UPDATE cf_domains d SET graph_protocol=2 FROM cf_graph_protocols p
        WHERE (d.tenant_id,d.id)=(p.tenant_id,p.domain_id);
    CREATE FUNCTION cf_graph_protocol_row_guard() RETURNS trigger
        LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
    BEGIN
        IF NEW.graph_protocol<OLD.graph_protocol OR
           (NEW.graph_protocol=2 AND NOT EXISTS(SELECT 1 FROM public.cf_graph_protocols
              WHERE tenant_id=NEW.tenant_id AND domain_id=NEW.id AND protocol=2)) THEN
            RAISE EXCEPTION 'Graph protocol cannot be removed or forged' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END $$;
    CREATE TRIGGER graph_protocol_row_guard BEFORE UPDATE OF graph_protocol ON cf_domains
        FOR EACH ROW EXECUTE FUNCTION cf_graph_protocol_row_guard();
    CREATE FUNCTION cf_graph_protocol_enroll() RETURNS trigger
        LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
    BEGIN
        -- This tuple change forces a stale REPEATABLE READ writer to serialize/fail.
        UPDATE public.cf_domains SET graph_protocol=2
            WHERE tenant_id=NEW.tenant_id AND id=NEW.domain_id;
        RETURN NEW;
    END $$;
    CREATE TRIGGER graph_protocol_enroll AFTER INSERT ON cf_graph_protocols
        FOR EACH ROW EXECUTE FUNCTION cf_graph_protocol_enroll();
    CREATE OR REPLACE FUNCTION cf_graph_published_version_guard() RETURNS trigger
        LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
    DECLARE candidate public.cf_graph_attempts;
    BEGIN
        IF NEW.published_version IS NOT DISTINCT FROM OLD.published_version
            OR NEW.graph_protocol<>2 THEN RETURN NEW; END IF;
        IF NEW.published_version<>OLD.published_version+1 THEN
            RAISE EXCEPTION 'Graph publication must advance by one' USING ERRCODE='23514';
        END IF;
        SELECT a.* INTO candidate FROM public.cf_graph_manifests m
            JOIN public.cf_graph_preparations p USING(tenant_id,domain_id,version)
            JOIN public.cf_graph_attempts a ON
                (a.tenant_id,a.domain_id,a.version,a.id,a.generation)=
                (m.tenant_id,m.domain_id,m.version,m.attempt_id,m.generation)
            WHERE m.tenant_id=NEW.tenant_id AND m.domain_id=NEW.id AND m.version=NEW.published_version
              AND (m.attempt_id,m.generation)=(p.id,p.generation);
        IF NOT FOUND OR candidate.intent->>'kind' IS DISTINCT FROM 'publish'
            OR candidate.intent->>'base_version' IS DISTINCT FROM OLD.published_version::text THEN
            RAISE EXCEPTION 'Graph publication requires the current fenced manifest' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END $$;
    """)


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
