"""Immutable, rebuildable read projections of verified graph snapshots."""

from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
    CREATE TABLE cf_graph_read_versions (
        tenant_id text NOT NULL, domain_id text NOT NULL, version bigint NOT NULL,
        digest text NOT NULL CHECK(length(digest)=64),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(tenant_id,domain_id,version),
        FOREIGN KEY(tenant_id,domain_id,version)
            REFERENCES cf_graph_manifests(tenant_id,domain_id,version)
    );
    CREATE TABLE cf_graph_read_nodes (
        tenant_id text NOT NULL, domain_id text NOT NULL, version bigint NOT NULL,
        concept_id uuid NOT NULL, title text NOT NULL, maturity text NOT NULL,
        search_text jsonb NOT NULL, concept jsonb NOT NULL,
        PRIMARY KEY(tenant_id,domain_id,version,concept_id),
        FOREIGN KEY(tenant_id,domain_id,version)
            REFERENCES cf_graph_read_versions(tenant_id,domain_id,version)
    );
    CREATE TABLE cf_graph_read_sources (
        tenant_id text NOT NULL, domain_id text NOT NULL, version bigint NOT NULL,
        concept_id uuid NOT NULL, source_id text NOT NULL,
        PRIMARY KEY(tenant_id,domain_id,version,concept_id,source_id),
        FOREIGN KEY(tenant_id,domain_id,version,concept_id)
            REFERENCES cf_graph_read_nodes(tenant_id,domain_id,version,concept_id),
        FOREIGN KEY(tenant_id,domain_id,source_id) REFERENCES cf_sources(tenant_id,domain_id,id)
    );
    CREATE TABLE cf_graph_read_edges (
        tenant_id text NOT NULL, domain_id text NOT NULL, version bigint NOT NULL,
        origin uuid NOT NULL, target uuid NOT NULL, kind text NOT NULL,
        weight double precision NOT NULL, is_primary boolean NOT NULL,
        PRIMARY KEY(tenant_id,domain_id,version,origin,target,kind),
        FOREIGN KEY(tenant_id,domain_id,version,origin)
            REFERENCES cf_graph_read_nodes(tenant_id,domain_id,version,concept_id),
        FOREIGN KEY(tenant_id,domain_id,version,target)
            REFERENCES cf_graph_read_nodes(tenant_id,domain_id,version,concept_id)
    );
    CREATE INDEX graph_read_incoming ON cf_graph_read_edges(tenant_id,domain_id,version,target,origin);
    CREATE INDEX graph_read_source_nodes ON cf_graph_read_sources(tenant_id,domain_id,version,source_id,concept_id);
    GRANT SELECT,INSERT ON cf_graph_read_versions,cf_graph_read_nodes,cf_graph_read_sources,cf_graph_read_edges TO cortex_app;
    """)
    for table in (
        "cf_graph_read_versions",
        "cf_graph_read_nodes",
        "cf_graph_read_sources",
        "cf_graph_read_edges",
    ):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            "USING(tenant_id=current_setting('cortex.tenant',true)) "
            "WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
        )
        op.execute(
            f"CREATE TRIGGER immutable_graph_read BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION cf_immutable()"
        )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
