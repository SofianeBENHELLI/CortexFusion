"""Allow an explicit, fenced import replacement to seal its confirmed projection."""

from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL row_security=off")
    op.execute("""
    LOCK TABLE cf_domains,cf_graph_preparations,cf_graph_attempts,cf_graph_manifests
        IN ACCESS EXCLUSIVE MODE;
    GRANT UPDATE(intent) ON cf_graph_preparations TO cortex_app;
    CREATE FUNCTION cf_graph_import_replacement_allowed(
        t text,d text,v bigint,previous_id text,previous_generation bigint,
        new_id text,new_generation bigint,predecessor text,intent jsonb
    ) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
    DECLARE active public.cf_graph_preparations; previous public.cf_graph_attempts;
    BEGIN
        IF new_generation<>previous_generation+1 OR new_id=previous_id
            OR predecessor IS DISTINCT FROM previous_id
            OR jsonb_typeof(intent) IS DISTINCT FROM 'object'
            OR intent->>'kind' IS DISTINCT FROM 'import'
            OR intent->'base_version' IS DISTINCT FROM to_jsonb(v)
            OR COALESCE(intent->>'digest','') !~ '^[0-9a-f]{64}$'
            OR jsonb_typeof(intent->'count') IS DISTINCT FROM 'number'
            OR COALESCE(intent->>'count','') !~ '^(0|[1-9][0-9]*)$'
            OR (intent->>'count')::numeric>9223372036854775807
            OR intent-ARRAY['kind','base_version','digest','count']<>'{}'::jsonb
            OR NOT EXISTS(SELECT 1 FROM public.cf_domains WHERE tenant_id=t AND id=d AND published_version=v)
            OR EXISTS(SELECT 1 FROM public.cf_graph_manifests WHERE tenant_id=t AND domain_id=d AND version=v)
        THEN RETURN false; END IF;
        SELECT * INTO active FROM public.cf_graph_preparations
            WHERE tenant_id=t AND domain_id=d AND version=v;
        IF NOT FOUND OR active.id IS DISTINCT FROM previous_id
            OR active.generation IS DISTINCT FROM previous_generation THEN RETURN false; END IF;
        SELECT * INTO previous FROM public.cf_graph_attempts
            WHERE tenant_id=t AND domain_id=d AND version=v
              AND id=previous_id AND generation=previous_generation;
        IF NOT FOUND THEN RETURN false; END IF;
        RETURN COALESCE((previous.intent->>'kind'='legacy_import' AND active.intent IS NULL)
            OR (previous.intent->>'kind'='import' AND active.intent=previous.intent),false);
    END $$;

    CREATE OR REPLACE FUNCTION cf_graph_attempt_insert_guard() RETURNS trigger
        LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
    DECLARE previous public.cf_graph_attempts;
    BEGIN
        IF NEW.generation>1 THEN
            SELECT * INTO previous FROM public.cf_graph_attempts
                WHERE tenant_id=NEW.tenant_id AND domain_id=NEW.domain_id AND version=NEW.version
                  AND id=NEW.predecessor_id AND generation=NEW.generation-1;
            IF NOT FOUND OR ((previous.intent IS DISTINCT FROM NEW.intent OR
                previous.intent->>'kind' IN ('import','legacy_import')) AND NOT
                public.cf_graph_import_replacement_allowed(NEW.tenant_id,NEW.domain_id,NEW.version,
                    previous.id,previous.generation,NEW.id,NEW.generation,NEW.predecessor_id,NEW.intent)) THEN
                RAISE EXCEPTION 'Graph attempt predecessor does not match' USING ERRCODE='23514';
            END IF;
        END IF;
        RETURN NEW;
    END $$;
    CREATE OR REPLACE FUNCTION cf_graph_preparation_guard() RETURNS trigger
        LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
    DECLARE candidate public.cf_graph_attempts; import_transition boolean:=false;
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
            IF NEW.intent IS DISTINCT FROM OLD.intent OR
                ((NEW.id IS DISTINCT FROM OLD.id OR NEW.generation IS DISTINCT FROM OLD.generation)
                 AND COALESCE(NEW.intent->>'kind','')='import') THEN
                import_transition:=public.cf_graph_import_replacement_allowed(
                    NEW.tenant_id,NEW.domain_id,NEW.version,OLD.id,OLD.generation,
                    NEW.id,NEW.generation,OLD.id,NEW.intent);
                IF NOT import_transition THEN
                    RAISE EXCEPTION 'Only explicit active import replacement can change intent' USING ERRCODE='23514';
                END IF;
            END IF;
            IF (NEW.tenant_id,NEW.domain_id,NEW.version,NEW.subject,NEW.created_at)
                IS DISTINCT FROM (OLD.tenant_id,OLD.domain_id,OLD.version,OLD.subject,OLD.created_at)
            THEN
                RAISE EXCEPTION 'Graph preparation identity is immutable' USING ERRCODE='23514';
            END IF;
            IF NEW.id IS DISTINCT FROM OLD.id OR NEW.generation IS DISTINCT FROM OLD.generation THEN
                SELECT * INTO candidate FROM public.cf_graph_attempts
                    WHERE tenant_id=NEW.tenant_id AND domain_id=NEW.domain_id AND version=NEW.version
                      AND id=NEW.id AND generation=NEW.generation;
                IF NOT FOUND OR NEW.generation<>OLD.generation+1
                   OR candidate.predecessor_id IS DISTINCT FROM OLD.id
                   OR (candidate.intent IS DISTINCT FROM OLD.intent AND NOT import_transition)
                   OR candidate.intent IS DISTINCT FROM NEW.intent OR NEW.status<>'preparing'
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
    CREATE OR REPLACE FUNCTION cf_graph_manifest_guard() RETURNS trigger
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
        IF candidate.intent->>'kind'='import' AND NOT EXISTS(
            SELECT 1 FROM public.cf_domains WHERE tenant_id=NEW.tenant_id AND id=NEW.domain_id
              AND published_version=NEW.version) THEN
            RAISE EXCEPTION 'An import can only register the current published version' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END $$;
    """)


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
