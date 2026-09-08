"""Stable append-order cursors for graph attempt events."""

from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL row_security=off")
    op.execute("""
    LOCK TABLE cf_graph_attempt_events IN ACCESS EXCLUSIVE MODE;
    ALTER TABLE cf_graph_attempt_events ADD COLUMN ordinal bigint;
    ALTER TABLE cf_graph_attempt_events DISABLE TRIGGER immutable_cf_graph_attempt_events;
    WITH ordered AS (
        SELECT tenant_id,id,row_number() OVER (
            ORDER BY generation,recorded_at,id,tenant_id) AS ordinal
        FROM cf_graph_attempt_events
    ) UPDATE cf_graph_attempt_events e SET ordinal=o.ordinal FROM ordered o
        WHERE (e.tenant_id,e.id)=(o.tenant_id,o.id);
    ALTER TABLE cf_graph_attempt_events ENABLE TRIGGER immutable_cf_graph_attempt_events;
    ALTER TABLE cf_graph_attempt_events ALTER COLUMN ordinal SET NOT NULL;
    ALTER TABLE cf_graph_attempt_events ALTER COLUMN ordinal ADD GENERATED ALWAYS AS IDENTITY;
    SELECT setval(pg_get_serial_sequence('cf_graph_attempt_events','ordinal'),
        GREATEST(COALESCE((SELECT max(ordinal) FROM cf_graph_attempt_events),0),1),
        EXISTS(SELECT 1 FROM cf_graph_attempt_events));
    GRANT USAGE ON SEQUENCE cf_graph_attempt_events_ordinal_seq TO cortex_app;
    CREATE UNIQUE INDEX cf_graph_event_ordinal ON cf_graph_attempt_events(ordinal);
    CREATE INDEX cf_graph_event_cursor ON cf_graph_attempt_events(tenant_id,domain_id,version,ordinal);
    """)


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
