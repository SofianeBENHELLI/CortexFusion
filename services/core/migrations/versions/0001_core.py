"""Initial governed knowledge schema and tenant isolation."""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

DDL = r"""
CREATE TABLE cf_tenants (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE cf_domains (
 tenant_id text NOT NULL REFERENCES cf_tenants(id), id text NOT NULL,
 name text NOT NULL, accepted_version bigint NOT NULL DEFAULT 0,
 published_version bigint NOT NULL DEFAULT 0, PRIMARY KEY(tenant_id,id),
 CHECK (published_version <= accepted_version)
);
CREATE TABLE cf_memberships (
 tenant_id text NOT NULL, domain_id text NOT NULL, subject text NOT NULL,
 role text NOT NULL CHECK(role IN ('owner','viewer','agent','contributor')),
 PRIMARY KEY(tenant_id,domain_id,subject),
 FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id)
);
CREATE TABLE cf_sources (
 tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
 title text NOT NULL, location text NOT NULL, content text NOT NULL,
 content_hash text NOT NULL, allowed_subjects jsonb NOT NULL,
 supersedes text, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,domain_id,id),
 UNIQUE(tenant_id,domain_id,location,content_hash),
 FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id),
 FOREIGN KEY(tenant_id,domain_id,supersedes) REFERENCES cf_sources(tenant_id,domain_id,id),
 CHECK(jsonb_typeof(allowed_subjects)='array' AND jsonb_array_length(allowed_subjects)>0)
);
CREATE TABLE cf_proposals (
 tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
 author text NOT NULL, base_version bigint NOT NULL, payload jsonb NOT NULL,
 digest text NOT NULL, reason text NOT NULL, validation jsonb NOT NULL,
 status text NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','approved','published')),
 idempotency_key text NOT NULL, request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,domain_id,id),
 UNIQUE(tenant_id,domain_id,author,idempotency_key),
 FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id)
);
CREATE TABLE cf_commits (
 tenant_id text NOT NULL, domain_id text NOT NULL, sequence bigint NOT NULL,
 proposal_id text NOT NULL, author text NOT NULL, reason text NOT NULL,
 digest text NOT NULL, changes jsonb NOT NULL, before_state jsonb NOT NULL,
 decision_key text NOT NULL, decision_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), schema_version integer NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant_id,domain_id,sequence),
 UNIQUE(tenant_id,domain_id,proposal_id), UNIQUE(tenant_id,domain_id,author,decision_key),
 FOREIGN KEY(tenant_id,domain_id,proposal_id) REFERENCES cf_proposals(tenant_id,domain_id,id)
);
CREATE TABLE cf_outbox (
 tenant_id text NOT NULL, domain_id text NOT NULL, sequence bigint NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done')),
 attempts integer NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,domain_id,sequence),
 FOREIGN KEY(tenant_id,domain_id,sequence) REFERENCES cf_commits(tenant_id,domain_id,sequence)
);
CREATE TABLE cf_concepts (
 tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
 payload jsonb NOT NULL, version bigint NOT NULL,
 PRIMARY KEY(tenant_id,domain_id,id),
 FOREIGN KEY(tenant_id,domain_id,version) REFERENCES cf_commits(tenant_id,domain_id,sequence)
);
CREATE TABLE cf_episodes (
 tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
 subject text NOT NULL, question text NOT NULL, result jsonb NOT NULL,
 source_ids jsonb NOT NULL, served_version bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,domain_id,id),
 FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id)
);
CREATE TABLE cf_feedback (
 tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
 episode_id text NOT NULL, subject text NOT NULL, payload jsonb NOT NULL,
 idempotency_key text NOT NULL, request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,domain_id,id),
 UNIQUE(tenant_id,domain_id,subject,idempotency_key),
 FOREIGN KEY(tenant_id,domain_id,episode_id) REFERENCES cf_episodes(tenant_id,domain_id,id)
);
CREATE TABLE cf_issues (
 tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
 episode_id text NOT NULL, kind text NOT NULL, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,domain_id,id),
 FOREIGN KEY(tenant_id,domain_id,episode_id) REFERENCES cf_episodes(tenant_id,domain_id,id)
);
CREATE FUNCTION cf_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable record'; END $$;
CREATE TRIGGER immutable_commit BEFORE UPDATE OR DELETE ON cf_commits
 FOR EACH ROW EXECUTE FUNCTION cf_immutable();
CREATE TRIGGER immutable_episode BEFORE UPDATE OR DELETE ON cf_episodes
 FOR EACH ROW EXECUTE FUNCTION cf_immutable();
CREATE TRIGGER immutable_feedback BEFORE UPDATE OR DELETE ON cf_feedback
 FOR EACH ROW EXECUTE FUNCTION cf_immutable();
CREATE FUNCTION cf_source_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW) - 'allowed_subjects') IS DISTINCT FROM (to_jsonb(OLD) - 'allowed_subjects')
 THEN RAISE EXCEPTION 'source content is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_source_content BEFORE UPDATE ON cf_sources
 FOR EACH ROW EXECUTE FUNCTION cf_source_immutable();
"""

TABLES = [
    "domains",
    "memberships",
    "sources",
    "proposals",
    "commits",
    "outbox",
    "concepts",
    "episodes",
    "feedback",
    "issues",
]


def upgrade():
    op.execute(DDL)
    for name in TABLES:
        table = f"cf_{name}"
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} USING (tenant_id=current_setting('cortex.tenant',true)) WITH CHECK (tenant_id=current_setting('cortex.tenant',true))"
        )
    op.execute("ALTER TABLE cf_tenants ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE cf_tenants FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON cf_tenants USING (id=current_setting('cortex.tenant',true)) WITH CHECK (id=current_setting('cortex.tenant',true))"
    )
    # Provision this non-login group before running migrations; grant login roles membership.
    op.execute("GRANT USAGE ON SCHEMA public TO cortex_app")
    op.execute("GRANT SELECT ON ALL TABLES IN SCHEMA public TO cortex_app")
    op.execute(
        "GRANT INSERT ON cf_sources,cf_proposals,cf_commits,cf_outbox,cf_concepts,cf_episodes,cf_feedback,cf_issues TO cortex_app"
    )
    op.execute("GRANT UPDATE ON cf_domains,cf_proposals,cf_outbox,cf_concepts TO cortex_app")
    op.execute("GRANT UPDATE(allowed_subjects) ON cf_sources TO cortex_app")
    op.execute("GRANT DELETE ON cf_concepts TO cortex_app")


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled; restore a test database explicitly")
