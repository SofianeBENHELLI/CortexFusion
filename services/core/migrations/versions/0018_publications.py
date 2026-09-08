"""Record successful publication separately from acceptance, without historical backfill."""

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE cf_publications (
        tenant_id text NOT NULL, domain_id text NOT NULL, sequence bigint NOT NULL,
        publisher text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(tenant_id,domain_id,sequence),
        FOREIGN KEY(tenant_id,domain_id,sequence) REFERENCES cf_commits(tenant_id,domain_id,sequence)
    );
    ALTER TABLE cf_publications ENABLE ROW LEVEL SECURITY;
    ALTER TABLE cf_publications FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON cf_publications
        USING(tenant_id=current_setting('cortex.tenant',true))
        WITH CHECK(tenant_id=current_setting('cortex.tenant',true));
    GRANT SELECT,INSERT ON cf_publications TO cortex_app;
    CREATE TRIGGER immutable_publication BEFORE UPDATE OR DELETE ON cf_publications
        FOR EACH ROW EXECUTE FUNCTION cf_immutable();
    """)


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
