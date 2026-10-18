"""Explicit cumulative human roles with a compatible effective role projection."""

from alembic import op

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
    ALTER TABLE cf_memberships ADD COLUMN roles text[];
    UPDATE cf_memberships SET roles=ARRAY[role];
    ALTER TABLE cf_memberships ALTER COLUMN roles SET NOT NULL;
    CREATE FUNCTION cf_membership_roles() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE canonical text[];
    BEGIN
      IF TG_OP='INSERT' THEN
        IF NEW.roles IS NULL THEN NEW.roles:=ARRAY[NEW.role]; END IF;
      ELSIF NEW.roles IS NOT DISTINCT FROM OLD.roles AND NEW.role IS DISTINCT FROM OLD.role THEN
        NEW.roles:=ARRAY[NEW.role];
      END IF;
      SELECT array_agg(r ORDER BY rank) INTO canonical
        FROM unnest(ARRAY['owner','corpus_manager','contributor','viewer','agent']) WITH ORDINALITY AS permitted(r,rank)
        WHERE r=ANY(NEW.roles);
      IF canonical IS NULL OR cardinality(canonical)<>cardinality(NEW.roles)
        OR (cardinality(canonical)>1 AND 'agent'=ANY(canonical)) THEN
        RAISE EXCEPTION 'Invalid membership roles' USING ERRCODE='23514';
      END IF;
      NEW.roles:=canonical;
      NEW.role:=canonical[1];
      RETURN NEW;
    END $$;
    CREATE TRIGGER cf_membership_roles_sync BEFORE INSERT OR UPDATE OF role,roles ON cf_memberships
      FOR EACH ROW EXECUTE FUNCTION cf_membership_roles();
    GRANT UPDATE(roles) ON cf_memberships TO cortex_app;
    ALTER TABLE cf_membership_events ADD COLUMN previous_roles text[];
    ALTER TABLE cf_membership_events ADD COLUMN new_roles text[];
    """)


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled")
