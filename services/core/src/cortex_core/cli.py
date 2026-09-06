"""Administrative bootstrap and API entry point. Credentials are never printed."""

import argparse
from uuid import UUID

from sqlalchemy import create_engine, text


def main():
    parser = argparse.ArgumentParser(prog="cortex")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve")
    serve.add_argument("--port", type=int, default=8000)
    bootstrap = sub.add_parser(
        "bootstrap", help="Create domain membership using migration credentials"
    )
    bootstrap.add_argument("--tenant", type=UUID, required=True)
    bootstrap.add_argument("--domain", type=UUID, required=True)
    bootstrap.add_argument("--owner", required=True)
    bootstrap.add_argument("--name", default="First domain")
    bootstrap.add_argument(
        "--member", action="append", default=[], help="subject:viewer or subject:agent"
    )
    args = parser.parse_args()
    if args.command == "serve":
        import uvicorn

        uvicorn.run("cortex_core.api:create_app", factory=True, host="127.0.0.1", port=args.port)
        return
    import os

    engine = create_engine(os.environ["CORTEX_MIGRATION_DATABASE_URL"])
    with engine.begin() as conn:
        tenant, domain = str(args.tenant), str(args.domain)
        conn.execute(text("SELECT set_config('cortex.tenant', :t, true)"), {"t": tenant})
        conn.execute(
            text("INSERT INTO cf_tenants(id,name) VALUES(:t,:name) ON CONFLICT DO NOTHING"),
            {"t": tenant, "name": args.name},
        )
        conn.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,:name) ON CONFLICT DO NOTHING"
            ),
            {"t": tenant, "d": domain, "name": args.name},
        )
        members = [(args.owner, "owner")]
        for value in args.member:
            subject, role = value.rsplit(":", 1)
            if role not in ("viewer", "agent", "contributor"):
                parser.error("member role must be viewer, agent, or contributor")
            members.append((subject, role))
        for subject, role in members:
            conn.execute(
                text(
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,:s,:r) ON CONFLICT DO NOTHING"
                ),
                {"t": tenant, "d": domain, "s": subject, "r": role},
            )
    engine.dispose()
    print(f"Domain {domain} initialized; no corpus imported.")
