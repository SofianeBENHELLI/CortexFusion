"""Reserve graph snapshot preparation and bind immutable engine commits to published versions."""

from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE cf_graph_preparations (
        tenant_id text NOT NULL, domain_id text NOT NULL, version bigint NOT NULL CHECK(version>=0),
        id text NOT NULL, subject text NOT NULL,
        status text NOT NULL CHECK(status IN ('preparing','ready','uncertain','stale')),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(tenant_id,domain_id,version), UNIQUE(tenant_id,id),
        FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id)
    );
    CREATE TABLE cf_graph_manifests (
        tenant_id text NOT NULL, domain_id text NOT NULL, version bigint NOT NULL CHECK(version>=0),
        snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(tenant_id,domain_id,version),
        FOREIGN KEY(tenant_id,domain_id,version) REFERENCES cf_graph_preparations(tenant_id,domain_id,version)
    );
    CREATE TRIGGER immutable_graph_manifest BEFORE UPDATE OR DELETE ON cf_graph_manifests
        FOR EACH ROW EXECUTE FUNCTION cf_immutable();
    GRANT SELECT,INSERT ON cf_graph_preparations,cf_graph_manifests TO cortex_app;
    GRANT UPDATE(status) ON cf_graph_preparations TO cortex_app;
    """)
    for table in ("cf_graph_preparations", "cf_graph_manifests"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            "USING(tenant_id=current_setting('cortex.tenant',true)) "
            "WITH CHECK(tenant_id=current_setting('cortex.tenant',true))"
        )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
