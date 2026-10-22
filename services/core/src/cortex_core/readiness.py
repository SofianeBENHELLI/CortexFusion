"""Public readiness checks disclose only readiness, never database diagnostics."""

from sqlalchemy import create_engine, text

from .auth import CoreError

SCHEMA_REVISION = "0043"
REQUIRED_TABLES = frozenset(
    """
cf_work_activity_reads cf_agent_mission_preparations cf_agent_missions cf_agent_mission_commands cf_reference_review_preparations cf_reference_reviews cf_reference_review_commands cf_reference_drafts cf_reference_draft_receipts cf_import_commands cf_task_proposals cf_expert_reviews cf_case_preparations cf_shared_cases cf_case_events cf_case_commands cf_workspace_cursors cf_task_notification_reads cf_work_tasks cf_task_events cf_task_commands cf_task_outbox cf_workspace_drafts cf_workspace_draft_receipts cf_graph_read_versions cf_graph_read_nodes cf_graph_read_sources cf_graph_read_edges
cf_collection_sources cf_collections cf_commits cf_companion_responses cf_concepts
cf_conversation_episodes cf_conversations cf_domains cf_episodes cf_extractions
cf_feedback cf_feedback_preferences cf_feedback_signals cf_files cf_import_items
cf_imports cf_issue_events cf_issues cf_mcp_confirmations cf_membership_events
cf_memberships cf_model_attempts cf_model_outcomes cf_outbox cf_proposals cf_reviews
cf_graph_preparations cf_graph_manifests cf_graph_attempts cf_graph_attempt_events cf_graph_protocols cf_publications cf_source_access_events cf_sources cf_synthesis_attempts cf_synthesis_outcomes cf_tenants
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
        # Never the application pool, and never more than one session: this public
        # probe waits at most a second for its connection, so unauthenticated
        # callers cannot open unbounded PostgreSQL sessions. Driver socket and
        # statement deadlines bound each probe; they are not an overall SLA.
        self.engine = create_engine(
            db.engine.url,
            pool_size=1,
            max_overflow=0,
            pool_timeout=1,
            pool_pre_ping=True,
            connect_args={"timeout": 2},
        )

    def check(self):
        try:
            with self.engine.begin() as conn:
                conn.execute(text("SET LOCAL statement_timeout='1500ms'"))
                if not verify_schema(conn):
                    raise ValueError("incompatible database")
            return {"status": "ready", "schema_revision": SCHEMA_REVISION}
        except Exception:
            raise CoreError("NOT_READY", "Backend database readiness checks failed", 503) from None

    def dispose(self):
        self.engine.dispose()
