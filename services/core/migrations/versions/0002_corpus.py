"""Private collections and resumable text import receipts."""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE cf_memberships DROP CONSTRAINT cf_memberships_role_check")
    op.execute(
        "ALTER TABLE cf_memberships ADD CHECK(role IN ('owner','viewer','agent','contributor','corpus_manager'))"
    )
    op.execute("""
    CREATE TABLE cf_collections (
      tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
      name text NOT NULL, description text NOT NULL, allowed_subjects jsonb NOT NULL,
      author text NOT NULL, idempotency_key text NOT NULL, request_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(tenant_id,domain_id,id),
      UNIQUE(tenant_id,domain_id,author,idempotency_key),
      FOREIGN KEY(tenant_id,domain_id) REFERENCES cf_domains(tenant_id,id),
      CHECK(jsonb_typeof(allowed_subjects)='array' AND jsonb_array_length(allowed_subjects)>0)
    );
    CREATE TABLE cf_collection_sources (
      tenant_id text NOT NULL, domain_id text NOT NULL, collection_id text NOT NULL,
      source_id text NOT NULL,
      PRIMARY KEY(tenant_id,domain_id,collection_id,source_id),
      FOREIGN KEY(tenant_id,domain_id,collection_id) REFERENCES cf_collections(tenant_id,domain_id,id),
      FOREIGN KEY(tenant_id,domain_id,source_id) REFERENCES cf_sources(tenant_id,domain_id,id)
    );
    CREATE TABLE cf_imports (
      tenant_id text NOT NULL, domain_id text NOT NULL, id text NOT NULL,
      collection_id text NOT NULL, author text NOT NULL,
      idempotency_key text NOT NULL, request_hash text NOT NULL,
      cancelled boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(tenant_id,domain_id,id),
      UNIQUE(tenant_id,domain_id,author,idempotency_key),
      FOREIGN KEY(tenant_id,domain_id,collection_id) REFERENCES cf_collections(tenant_id,domain_id,id)
    );
    CREATE TABLE cf_import_items (
      tenant_id text NOT NULL, domain_id text NOT NULL, import_id text NOT NULL,
      position integer NOT NULL, payload jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','succeeded','failed','cancelled')),
      source_id text, error_code text, attempts integer NOT NULL DEFAULT 0,
      PRIMARY KEY(tenant_id,domain_id,import_id,position),
      FOREIGN KEY(tenant_id,domain_id,import_id) REFERENCES cf_imports(tenant_id,domain_id,id),
      FOREIGN KEY(tenant_id,domain_id,source_id) REFERENCES cf_sources(tenant_id,domain_id,id),
      CHECK ((status='succeeded') = (source_id IS NOT NULL))
    );
    CREATE INDEX cf_sources_domain_page ON cf_sources(tenant_id,domain_id,id);
    """)
    for name in ("collections", "collection_sources", "imports", "import_items"):
        table = f"cf_{name}"
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} USING (tenant_id=current_setting('cortex.tenant',true)) WITH CHECK (tenant_id=current_setting('cortex.tenant',true))"
        )
        op.execute(f"GRANT SELECT, INSERT ON {table} TO cortex_app")
    op.execute("GRANT UPDATE(cancelled) ON cf_imports TO cortex_app")
    op.execute(
        "GRANT UPDATE(status,source_id,error_code,attempts) ON cf_import_items TO cortex_app"
    )
    op.execute(
        "CREATE TRIGGER immutable_collection BEFORE UPDATE OR DELETE ON cf_collections FOR EACH ROW EXECUTE FUNCTION cf_immutable()"
    )


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled; restore a test database explicitly")
