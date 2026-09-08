"""Fence immutable graph attempts, including activation by legacy publishers."""

from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade():
    # Fail rather than silently backfill a policy-filtered subset of existing data.
    op.execute("SET LOCAL row_security=off")
    op.execute("""LOCK TABLE cf_domains,cf_graph_preparations,cf_graph_manifests
        IN ACCESS EXCLUSIVE MODE;
    CREATE TABLE cf_graph_protocols (
        tenant_id text NOT NULL, domain_id text NOT NULL,
        protocol integer NOT NULL CHECK(protocol=2), subject text NOT NULL,
        activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(tenant_id,domain_id),
        FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id)
    );
    CREATE TABLE cf_graph_attempts (
        tenant_id text NOT NULL, domain_id text NOT NULL, version bigint NOT NULL CHECK(version>=0),
        id text NOT NULL CHECK(id::uuid::text=id), generation bigint NOT NULL CHECK(generation>0),
        predecessor_id text, subject text NOT NULL CHECK(length(subject)>0),
        reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
        idempotency_key text, fingerprint text,
        intent jsonb NOT NULL CHECK(jsonb_typeof(intent)='object'),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(tenant_id,domain_id,version,id,generation),
        UNIQUE(tenant_id,id), UNIQUE(tenant_id,domain_id,version,generation),
        UNIQUE(tenant_id,domain_id,subject,idempotency_key),
        CHECK((idempotency_key IS NULL)=(fingerprint IS NULL)),
        CHECK(fingerprint IS NULL OR fingerprint ~ '^[0-9a-f]{64}$'),
        CHECK((generation=1 AND predecessor_id IS NULL) OR
              (generation>1 AND predecessor_id IS NOT NULL AND idempotency_key IS NOT NULL)),
        FOREIGN KEY(tenant_id,domain_id,version)
            REFERENCES cf_graph_preparations(tenant_id,domain_id,version)
            DEFERRABLE INITIALLY DEFERRED
    );
    CREATE TABLE cf_graph_attempt_events (
        tenant_id text NOT NULL, domain_id text NOT NULL, version bigint NOT NULL,
        attempt_id text NOT NULL, generation bigint NOT NULL,
        id text NOT NULL CHECK(id::uuid::text=id), subject text NOT NULL CHECK(length(subject)>0),
        kind text NOT NULL CHECK(kind IN ('reserved','uncertain','ready','stale','superseded')),
        recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(tenant_id,id),
        FOREIGN KEY(tenant_id,domain_id,version,attempt_id,generation)
            REFERENCES cf_graph_attempts(tenant_id,domain_id,version,id,generation)
            DEFERRABLE INITIALLY DEFERRED
    );
    ALTER TABLE cf_graph_preparations ADD COLUMN generation bigint;
    ALTER TABLE cf_graph_manifests ADD COLUMN attempt_id text;
    ALTER TABLE cf_graph_manifests ADD COLUMN generation bigint;
    DO $$ BEGIN
        IF EXISTS(SELECT 1 FROM cf_graph_manifests m
            JOIN cf_graph_preparations p USING(tenant_id,domain_id,version)
            WHERE m.snapshot->>'database' IS DISTINCT FROM
                'cf_snapshot_'||replace(p.id,'-','')) THEN
            RAISE EXCEPTION 'Existing graph manifest cannot be bound to its reservation';
        END IF;
        IF EXISTS(SELECT 1 FROM cf_graph_manifests m
            JOIN cf_graph_preparations p USING(tenant_id,domain_id,version)
            WHERE p.intent IS NOT NULL AND
                (p.intent->'digest' IS DISTINCT FROM m.snapshot->'digest'
                 OR p.intent->'count' IS DISTINCT FROM m.snapshot->'count')) THEN
            RAISE EXCEPTION 'Existing graph intent and manifest disagree';
        END IF;
    END $$;
    UPDATE cf_graph_preparations SET generation=1;
    INSERT INTO cf_graph_attempts(tenant_id,domain_id,version,id,generation,subject,reason,intent,created_at)
        SELECT p.tenant_id,p.domain_id,p.version,p.id,1,p.subject,'Migrated immutable reservation',
            COALESCE(p.intent,jsonb_build_object('kind','legacy_import','base_version',p.version,
                'digest',m.snapshot->'digest','count',m.snapshot->'count')),p.created_at
        FROM cf_graph_preparations p LEFT JOIN cf_graph_manifests m
            USING(tenant_id,domain_id,version);
    -- Exclusive locks and a single migration transaction prevent an unprotected window.
    ALTER TABLE cf_graph_manifests DISABLE TRIGGER immutable_graph_manifest;
    UPDATE cf_graph_manifests m SET attempt_id=p.id,generation=1
        FROM cf_graph_preparations p
        WHERE (m.tenant_id,m.domain_id,m.version)=(p.tenant_id,p.domain_id,p.version);
    ALTER TABLE cf_graph_manifests ENABLE TRIGGER immutable_graph_manifest;
    INSERT INTO cf_graph_protocols(tenant_id,domain_id,protocol,subject)
        SELECT DISTINCT ON(tenant_id,domain_id) tenant_id,domain_id,2,subject
        FROM cf_graph_preparations ORDER BY tenant_id,domain_id,version;
    SET CONSTRAINTS ALL IMMEDIATE;
    ALTER TABLE cf_graph_preparations ALTER COLUMN generation SET NOT NULL;
    ALTER TABLE cf_graph_preparations ADD CHECK(generation>0);
    ALTER TABLE cf_graph_preparations ADD FOREIGN KEY(tenant_id,domain_id,version,id,generation)
        REFERENCES cf_graph_attempts(tenant_id,domain_id,version,id,generation)
        DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE cf_graph_manifests ALTER COLUMN attempt_id SET NOT NULL;
    ALTER TABLE cf_graph_manifests ALTER COLUMN generation SET NOT NULL;
    ALTER TABLE cf_graph_manifests ADD FOREIGN KEY(tenant_id,domain_id,version,attempt_id,generation)
        REFERENCES cf_graph_attempts(tenant_id,domain_id,version,id,generation);
    CREATE INDEX graph_attempt_events_lookup ON cf_graph_attempt_events
        (tenant_id,domain_id,version,generation,recorded_at,id);
    """)
    for table in ("cf_graph_protocols", "cf_graph_attempts", "cf_graph_attempt_events"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            "USING(tenant_id=current_setting('cortex.tenant',true)) "
            "WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
        )
        op.execute(f"GRANT SELECT,INSERT ON {table} TO cortex_app")
        op.execute(
            f"CREATE TRIGGER immutable_{table} BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION cf_immutable()"
        )
    op.execute("GRANT UPDATE(id,generation) ON cf_graph_preparations TO cortex_app")
    op.execute("""
    CREATE FUNCTION cf_graph_attempt_insert_guard() RETURNS trigger
        LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
    DECLARE previous public.cf_graph_attempts;
    BEGIN
        IF NEW.generation>1 THEN
            SELECT * INTO previous FROM public.cf_graph_attempts
                WHERE tenant_id=NEW.tenant_id AND domain_id=NEW.domain_id AND version=NEW.version
                  AND id=NEW.predecessor_id AND generation=NEW.generation-1;
            IF NOT FOUND OR previous.intent IS DISTINCT FROM NEW.intent THEN
                RAISE EXCEPTION 'Graph attempt predecessor does not match' USING ERRCODE='23514';
            END IF;
        END IF;
        RETURN NEW;
    END $$;
    CREATE TRIGGER graph_attempt_insert_guard BEFORE INSERT ON cf_graph_attempts
        FOR EACH ROW EXECUTE FUNCTION cf_graph_attempt_insert_guard();

    CREATE FUNCTION cf_graph_active_identity_guard() RETURNS trigger
        LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
    DECLARE active public.cf_graph_preparations; candidate public.cf_graph_attempts;
    BEGIN
        SELECT * INTO active FROM public.cf_graph_preparations
            WHERE tenant_id=NEW.tenant_id AND domain_id=NEW.domain_id AND version=NEW.version;
        SELECT * INTO candidate FROM public.cf_graph_attempts
            WHERE tenant_id=active.tenant_id AND domain_id=active.domain_id AND version=active.version
              AND id=active.id AND generation=active.generation;
        IF NOT FOUND OR active.intent IS DISTINCT FROM candidate.intent
            OR (active.generation=1 AND active.subject IS DISTINCT FROM candidate.subject) THEN
            RAISE EXCEPTION 'Graph preparation and active attempt identities disagree' USING ERRCODE='23514';
        END IF;
        RETURN NULL;
    END $$;
    CREATE CONSTRAINT TRIGGER graph_active_identity_guard
        AFTER INSERT OR UPDATE ON cf_graph_preparations DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION cf_graph_active_identity_guard();
    CREATE CONSTRAINT TRIGGER graph_attempt_identity_guard
        AFTER INSERT ON cf_graph_attempts DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION cf_graph_active_identity_guard();

    CREATE FUNCTION cf_graph_preparation_guard() RETURNS trigger
        LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
    DECLARE candidate public.cf_graph_attempts;
    BEGIN
        IF NEW.id IS DISTINCT FROM current_setting('cortex.graph_attempt_id',true)
           OR NEW.generation::text IS DISTINCT FROM current_setting('cortex.graph_generation',true)
           OR NULLIF(current_setting('cortex.graph_actor',true),'') IS NULL THEN
            RAISE EXCEPTION 'Graph attempt proof does not match' USING ERRCODE='23514';
        END IF;
        IF NOT EXISTS(SELECT 1 FROM public.cf_memberships
            WHERE tenant_id=NEW.tenant_id AND domain_id=NEW.domain_id
              AND subject=current_setting('cortex.graph_actor',true) AND role='owner') THEN
            RAISE EXCEPTION 'Graph mutation requires a current owner' USING ERRCODE='23514';
        END IF;
        IF TG_OP='INSERT' THEN
            IF NEW.generation<>1 OR NEW.status<>'preparing' OR NEW.intent IS NULL
               OR COALESCE(NEW.intent->>'kind','') NOT IN ('publish','import') THEN
                RAISE EXCEPTION 'Graph preparation requires a sealed intent' USING ERRCODE='23514';
            END IF;
            INSERT INTO public.cf_graph_protocols(tenant_id,domain_id,protocol,subject)
                VALUES(NEW.tenant_id,NEW.domain_id,2,NEW.subject) ON CONFLICT DO NOTHING;
        ELSE
            IF (NEW.tenant_id,NEW.domain_id,NEW.version,NEW.subject,NEW.created_at,NEW.intent)
                IS DISTINCT FROM (OLD.tenant_id,OLD.domain_id,OLD.version,OLD.subject,OLD.created_at,OLD.intent)
            THEN
                RAISE EXCEPTION 'Graph preparation identity is immutable' USING ERRCODE='23514';
            END IF;
            IF NEW.id IS DISTINCT FROM OLD.id OR NEW.generation IS DISTINCT FROM OLD.generation THEN
                SELECT * INTO candidate FROM public.cf_graph_attempts
                    WHERE tenant_id=NEW.tenant_id AND domain_id=NEW.domain_id AND version=NEW.version
                      AND id=NEW.id AND generation=NEW.generation;
                IF NOT FOUND OR NEW.generation<>OLD.generation+1
                   OR candidate.predecessor_id IS DISTINCT FROM OLD.id
                   OR candidate.intent IS DISTINCT FROM OLD.intent OR NEW.status<>'preparing'
                   OR EXISTS(SELECT 1 FROM public.cf_graph_manifests
                      WHERE tenant_id=NEW.tenant_id AND domain_id=NEW.domain_id AND version=NEW.version)
                THEN
                    RAISE EXCEPTION 'Graph attempt replacement is not current' USING ERRCODE='23514';
                END IF;
                INSERT INTO public.cf_graph_attempt_events
                    (tenant_id,domain_id,version,attempt_id,generation,id,subject,kind)
                    VALUES(OLD.tenant_id,OLD.domain_id,OLD.version,OLD.id,OLD.generation,
                        gen_random_uuid()::text,current_setting('cortex.graph_actor'),'superseded');
            ELSIF EXISTS(SELECT 1 FROM public.cf_graph_manifests
                WHERE tenant_id=NEW.tenant_id AND domain_id=NEW.domain_id AND version=NEW.version)
                AND NEW.status<>'ready' THEN
                RAISE EXCEPTION 'Published preparation cannot be degraded' USING ERRCODE='23514';
            END IF;
        END IF;
        INSERT INTO public.cf_graph_attempt_events
            (tenant_id,domain_id,version,attempt_id,generation,id,subject,kind)
            VALUES(NEW.tenant_id,NEW.domain_id,NEW.version,NEW.id,NEW.generation,
                gen_random_uuid()::text,current_setting('cortex.graph_actor'),
                CASE WHEN NEW.status='preparing' THEN 'reserved' ELSE NEW.status END);
        RETURN NEW;
    END $$;
    CREATE TRIGGER graph_preparation_guard BEFORE INSERT OR UPDATE ON cf_graph_preparations
        FOR EACH ROW EXECUTE FUNCTION cf_graph_preparation_guard();

    CREATE FUNCTION cf_graph_manifest_guard() RETURNS trigger
        LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
    DECLARE active public.cf_graph_preparations; candidate public.cf_graph_attempts;
    BEGIN
        SELECT * INTO active FROM public.cf_graph_preparations
            WHERE tenant_id=NEW.tenant_id AND domain_id=NEW.domain_id AND version=NEW.version FOR UPDATE;
        IF NOT FOUND OR NEW.attempt_id IS DISTINCT FROM active.id
           OR NEW.generation IS DISTINCT FROM active.generation THEN
            RAISE EXCEPTION 'Graph manifest attempt is no longer active' USING ERRCODE='23514';
        END IF;
        SELECT * INTO candidate FROM public.cf_graph_attempts
            WHERE tenant_id=NEW.tenant_id AND domain_id=NEW.domain_id AND version=NEW.version
              AND id=NEW.attempt_id AND generation=NEW.generation;
        IF NOT FOUND OR candidate.intent IS DISTINCT FROM active.intent
           OR COALESCE(candidate.intent->>'kind','') NOT IN ('publish','import')
           OR NEW.snapshot->>'database' IS DISTINCT FROM 'cf_snapshot_'||replace(NEW.attempt_id,'-','')
           OR NEW.snapshot->'digest' IS DISTINCT FROM candidate.intent->'digest'
           OR NEW.snapshot->'count' IS DISTINCT FROM candidate.intent->'count'
           OR NEW.snapshot->>'digest' IS NULL OR NEW.snapshot->>'count' IS NULL THEN
            RAISE EXCEPTION 'Graph manifest does not match its sealed intent' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END $$;
    CREATE TRIGGER graph_manifest_guard BEFORE INSERT ON cf_graph_manifests
        FOR EACH ROW EXECUTE FUNCTION cf_graph_manifest_guard();

    CREATE FUNCTION cf_graph_published_version_guard() RETURNS trigger
        LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
    DECLARE candidate public.cf_graph_attempts;
    BEGIN
        IF NEW.published_version IS NOT DISTINCT FROM OLD.published_version
            OR NOT EXISTS(SELECT 1 FROM public.cf_graph_protocols
                WHERE tenant_id=NEW.tenant_id AND domain_id=NEW.id) THEN RETURN NEW; END IF;
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
    CREATE TRIGGER graph_published_version_guard BEFORE UPDATE OF published_version ON cf_domains
        FOR EACH ROW EXECUTE FUNCTION cf_graph_published_version_guard();
    """)


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
