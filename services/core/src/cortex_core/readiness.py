"""Public readiness checks disclose only readiness, never database diagnostics."""

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from .auth import CoreError

SCHEMA_REVISION = "0017"
REQUIRED_TABLES = frozenset(
    """
cf_collection_sources cf_collections cf_commits cf_companion_responses cf_concepts
cf_conversation_episodes cf_conversations cf_domains cf_episodes cf_extractions
cf_feedback cf_feedback_preferences cf_feedback_signals cf_files cf_import_items
cf_imports cf_issue_events cf_issues cf_mcp_confirmations cf_membership_events
cf_memberships cf_model_attempts cf_model_outcomes cf_outbox cf_proposals cf_reviews
cf_sources cf_synthesis_attempts cf_synthesis_outcomes cf_tenants
""".split()
)


def verify_schema(conn):
    role = conn.execute(
        text("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")
    ).one()
    if role.rolsuper or role.rolbypassrls:
        return False
    revisions = set(conn.execute(text("SELECT version_num FROM public.alembic_version")).scalars())
    if revisions != {SCHEMA_REVISION}:
        return False
    tables = (
        conn.execute(
            text("""SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
        pg_get_userbyid(c.relowner)=current_user AS owned,
        has_table_privilege(current_user,c.oid,'SELECT') AS readable
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'cf_%'""")
        )
        .mappings()
        .all()
    )
    return REQUIRED_TABLES <= {row["relname"] for row in tables} and all(
        row["relrowsecurity"]
        and row["relforcerowsecurity"]
        and not row["owned"]
        and row["readable"]
        for row in tables
    )


class ReadinessService:
    def __init__(self, db):
        self.db = db

    def check(self):
        engine = None
        try:
            # Do not wait for the application pool. Driver socket and statement
            # deadlines bound each probe operation; they are not an overall SLA.
            engine = create_engine(
                self.db.engine.url, poolclass=NullPool, connect_args={"timeout": 2}
            )
            with engine.begin() as conn:
                conn.execute(text("SET LOCAL statement_timeout='1500ms'"))
                if not verify_schema(conn):
                    raise ValueError("incompatible database")
            return {"status": "ready", "schema_revision": SCHEMA_REVISION}
        except Exception:
            raise CoreError("NOT_READY", "Backend database readiness checks failed", 503) from None
        finally:
            if engine is not None:
                engine.dispose()
