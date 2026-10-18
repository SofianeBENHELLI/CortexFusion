"""Bounded named agent reading missions; no model worker or knowledge decision."""

from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
    CREATE TABLE cf_agent_mission_preparations (
      tenant_id text NOT NULL, domain_id text NOT NULL, author text NOT NULL, id text NOT NULL,
      payload_hash text NOT NULL, author_revision bigint NOT NULL, agent_revision bigint NOT NULL,
      expires_at timestamptz NOT NULL DEFAULT(clock_timestamp()+interval '5 minutes'),
      PRIMARY KEY(tenant_id,domain_id,author,id),
      FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id)
    );
    CREATE TABLE cf_agent_missions (
      tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
      author text NOT NULL, agent text NOT NULL CHECK(author<>agent),
      title text NOT NULL, objective text NOT NULL, criteria text NOT NULL,
      source_id text NOT NULL, source_hash text NOT NULL,
      max_reads bigint NOT NULL CHECK(max_reads BETWEEN 1 AND 100),
      max_chars bigint NOT NULL CHECK(max_chars BETWEEN 1 AND 100000),
      reads_used bigint NOT NULL DEFAULT 0 CHECK(reads_used BETWEEN 0 AND max_reads),
      chars_used bigint NOT NULL DEFAULT 0 CHECK(chars_used BETWEEN 0 AND max_chars),
      expires_at timestamptz NOT NULL, preparation_id text NOT NULL,
      status text NOT NULL CHECK(status IN ('queued','running','stopped','completed')),
      revision bigint NOT NULL CHECK(revision>0),
      lease_id text, lease_expires_at timestamptz,
      report text NOT NULL DEFAULT '', hypotheses text NOT NULL DEFAULT '', evidence jsonb NOT NULL DEFAULT '[]',
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(tenant_id,domain_id,id),
      UNIQUE(tenant_id,domain_id,author,preparation_id),
      FOREIGN KEY(tenant_id,domain_id,author,preparation_id) REFERENCES cf_agent_mission_preparations(tenant_id,domain_id,author,id),
      FOREIGN KEY(tenant_id,domain_id,source_id) REFERENCES cf_sources(tenant_id,domain_id,id),
      CHECK((status='running')=(lease_id IS NOT NULL AND lease_expires_at IS NOT NULL))
    );
    CREATE TABLE cf_agent_mission_commands (
      tenant_id text NOT NULL, domain_id text NOT NULL, actor text NOT NULL,
      idempotency_key text NOT NULL, request_hash text NOT NULL,
      mission_id text NOT NULL, event_id text NOT NULL, action text NOT NULL,
      revision bigint NOT NULL, status text NOT NULL, reads_used bigint NOT NULL, chars_used bigint NOT NULL,
      lease_id text, lease_expires_at timestamptz, start_pos bigint, end_pos bigint, reason text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(tenant_id,domain_id,actor,idempotency_key),
      UNIQUE(tenant_id,domain_id,mission_id,revision),
      FOREIGN KEY(tenant_id,domain_id,mission_id) REFERENCES cf_agent_missions(tenant_id,domain_id,id),
      CHECK((start_pos IS NULL AND end_pos IS NULL) OR (action='read' AND start_pos>=0 AND end_pos>start_pos))
    );
    CREATE FUNCTION cf_agent_mission_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF ROW(NEW.tenant_id,NEW.domain_id,NEW.id,NEW.author,NEW.agent,NEW.title,NEW.objective,NEW.criteria,NEW.source_id,NEW.source_hash,NEW.max_reads,NEW.max_chars,NEW.expires_at,NEW.preparation_id,NEW.created_at)
        IS DISTINCT FROM ROW(OLD.tenant_id,OLD.domain_id,OLD.id,OLD.author,OLD.agent,OLD.title,OLD.objective,OLD.criteria,OLD.source_id,OLD.source_hash,OLD.max_reads,OLD.max_chars,OLD.expires_at,OLD.preparation_id,OLD.created_at)
        OR NEW.reads_used<OLD.reads_used OR NEW.chars_used<OLD.chars_used
      THEN RAISE EXCEPTION 'mission scope and consumed budget are immutable'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER immutable_agent_mission BEFORE UPDATE ON cf_agent_missions FOR EACH ROW EXECUTE FUNCTION cf_agent_mission_immutable();
    GRANT SELECT,INSERT ON cf_agent_mission_preparations,cf_agent_mission_commands TO cortex_app;
    GRANT SELECT,INSERT,UPDATE ON cf_agent_missions TO cortex_app;
    CREATE INDEX cf_agent_missions_named ON cf_agent_missions(tenant_id,domain_id,agent,id);
    """)
    for table in (
        "cf_agent_mission_preparations",
        "cf_agent_missions",
        "cf_agent_mission_commands",
    ):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} USING(tenant_id=current_setting('cortex.tenant',true)) WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
        )
        if table != "cf_agent_missions":
            op.execute(
                f"CREATE TRIGGER immutable_agent_mission_record BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION cf_immutable()"
            )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
