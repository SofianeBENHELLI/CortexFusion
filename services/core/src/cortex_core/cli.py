"""Administrative bootstrap and API entry point. Credentials are never printed."""

import argparse
from uuid import UUID

from sqlalchemy import create_engine, text


def main():
    parser = argparse.ArgumentParser(prog="cortex")
    sub = parser.add_subparsers(dest="command", required=True)
    model_check = sub.add_parser(
        "model-check", help="Check OpenRouter configuration; --live sends one synthetic request"
    )
    model_check.add_argument("--model", help="Exact OpenRouter model ID; otherwise use environment")
    model_check.add_argument(
        "--live", action="store_true", help="Make one potentially paid request"
    )
    model_check.add_argument(
        "--prompt-key", action="store_true", help="Read key privately from an interactive terminal"
    )
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
    worker = sub.add_parser(
        "worker", help="Run the trusted-host file parser for one configured identity/domain"
    )
    worker.add_argument("--tenant", type=UUID, required=True)
    worker.add_argument("--domain", type=UUID, required=True)
    worker.add_argument("--subject", required=True)
    worker.add_argument("--once", action="store_true")
    worker.add_argument("--max-jobs", type=int, default=20, choices=range(1, 101))
    worker.add_argument("--poll-seconds", type=int, default=5, choices=range(1, 301))
    args = parser.parse_args()
    if args.command == "model-check":
        import json

        from .model_check import check_model

        key = None
        if args.prompt_key:
            import getpass
            import sys

            from pydantic import SecretStr

            if not sys.stdin.isatty():
                parser.error("--prompt-key requires an interactive terminal")
            key = SecretStr(getpass.getpass("OpenRouter API key (hidden): "))
        report, status = check_model(live=args.live, model=args.model, api_key=key)
        print(json.dumps(report, ensure_ascii=False))
        raise SystemExit(status)
    if args.command == "worker":
        from .worker import run_worker

        run_worker(
            str(args.tenant),
            str(args.domain),
            args.subject,
            args.once,
            args.max_jobs,
            args.poll_seconds,
        )
        return
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
            if role not in ("viewer", "agent", "contributor", "corpus_manager"):
                parser.error("member role must be viewer, agent, contributor, or corpus_manager")
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
