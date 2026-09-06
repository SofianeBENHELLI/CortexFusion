from contextlib import contextmanager

from sqlalchemy import create_engine, text

from .auth import CoreError, Principal


class Database:
    def __init__(self, url: str):
        self.engine = create_engine(url, pool_pre_ping=True)

    def verify_role(self):
        with self.engine.connect() as conn:
            role = conn.execute(
                text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user")
            ).one()
            if role.rolsuper or role.rolbypassrls:
                raise RuntimeError("API database role must not be superuser or BYPASSRLS")
            owns = conn.execute(
                text(
                    "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'cf_%' AND tableowner=current_user"
                )
            ).scalar_one()
            if owns:
                raise RuntimeError("API database role must not own application tables")

    @contextmanager
    def transaction(
        self,
        principal: Principal,
        domain: str,
        *,
        owner=False,
        write=False,
        corpus=False,
        isolation="REPEATABLE READ",
    ):
        with self.engine.connect().execution_options(isolation_level=isolation) as conn:
            with conn.begin():
                conn.execute(
                    text("SELECT set_config('cortex.tenant', :tenant, true)"),
                    {"tenant": principal.tenant_id},
                )
                role = conn.execute(
                    text(
                        "SELECT role FROM cf_memberships WHERE tenant_id=:tenant AND domain_id=:domain AND subject=:subject"
                    ),
                    {"tenant": principal.tenant_id, "domain": domain, "subject": principal.subject},
                ).scalar_one_or_none()
                if not role:
                    raise CoreError("NOT_FOUND", "Domain not found", 404)
                if owner and role != "owner":
                    raise CoreError("NOT_AUTHORIZED", "Domain owner required", 403)
                if corpus and role not in ("owner", "corpus_manager"):
                    raise CoreError("NOT_AUTHORIZED", "Corpus management permission required", 403)
                if write and role not in ("owner", "agent", "contributor", "corpus_manager"):
                    raise CoreError("NOT_AUTHORIZED", "Proposal permission required", 403)
                yield conn

    def dispose(self):
        self.engine.dispose()
