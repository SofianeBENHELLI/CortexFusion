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
    companion = sub.add_parser(
        "companion-ask", help="Ask through MCP and record one cited OpenRouter response"
    )
    companion.add_argument("--endpoint", required=True)
    companion.add_argument("--tenant", type=UUID, required=True)
    companion.add_argument("--domain", type=UUID, required=True)
    companion.add_argument("--question", required=True)
    companion.add_argument(
        "--conversation-id",
        type=UUID,
        help="Append this question to an existing personal conversation",
    )
    companion.add_argument("--request-id", type=UUID, required=True)
    companion.add_argument(
        "--journal", required=True, help="Private persistent local SQLite journal"
    )
    companion.add_argument(
        "--budget-usd", required=True, help="Fixed conservative journal allowance, 0.05–5 USD"
    )
    companion.add_argument(
        "--allow-openrouter",
        action="store_true",
        required=True,
        help="Authorize sending this question and retrieved excerpts to OpenRouter",
    )
    conversation = sub.add_parser(
        "companion-conversation", help="Create a personal conversation through MCP; no model call"
    )
    feedback = sub.add_parser(
        "companion-feedback",
        help="Record host-declared feedback on an exact response; no model call",
    )
    for command in (conversation, feedback):
        command.add_argument("--endpoint", required=True)
        command.add_argument("--tenant", type=UUID, required=True)
        command.add_argument("--domain", type=UUID, required=True)
        command.add_argument("--request-id", type=UUID, required=True)
    conversation.add_argument("--title", required=True)
    feedback.add_argument("--response-id", type=UUID, required=True)
    feedback.add_argument("--origin", choices=["explicit", "observed", "inferred"], required=True)
    feedback.add_argument(
        "--kind",
        choices=[
            "thumbs_up",
            "thumbs_down",
            "comment",
            "resolved",
            "reformulation",
            "correction",
            "abandon",
            "satisfaction",
        ],
        required=True,
    )
    feedback.add_argument("--comment", default="")
    feedback.add_argument("--iteration-index", type=int)
    feedback.add_argument("--confidence", type=float)
    feedback.add_argument("--sentiment", choices=["positive", "negative", "neutral"])
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
    if args.command in {"companion-conversation", "companion-feedback"}:
        import asyncio
        import json
        import os

        from .companion import (
            connected_session,
            create_conversation,
            record_feedback,
            safe_error_code,
        )

        async def operation():
            async with connected_session(
                endpoint=args.endpoint,
                token=os.environ["CORTEX_COMPANION_TOKEN"],
                tenant=str(args.tenant),
            ) as session:
                common = {"domain": str(args.domain), "request_id": str(args.request_id)}
                if args.command == "companion-conversation":
                    return await create_conversation(session, title=args.title, **common)
                return await record_feedback(
                    session,
                    response_id=str(args.response_id),
                    origin=args.origin,
                    kind=args.kind,
                    comment=args.comment,
                    iteration_index=args.iteration_index,
                    confidence=args.confidence,
                    sentiment=args.sentiment,
                    **common,
                )

        try:
            print(json.dumps(asyncio.run(operation()), ensure_ascii=False))
        except Exception as exc:
            print(
                json.dumps(
                    {
                        "error": safe_error_code(exc),
                        "message": "Companion operation did not complete",
                    }
                )
            )
            raise SystemExit(1) from None
        return
    if args.command == "companion-ask":
        import asyncio
        import json
        import os

        from pydantic import SecretStr

        from .companion import Journal, OpenRouterSynthesis, connect_and_ask, safe_error_code

        try:
            token = os.environ["CORTEX_COMPANION_TOKEN"]
            model = OpenRouterSynthesis(
                os.environ["CORTEX_OPENROUTER_MODEL"],
                SecretStr(
                    os.environ.get("CORTEX_OPENROUTER_API_KEY") or os.environ["OPENROUTER_API_KEY"]
                ),
            )
            with Journal(args.journal, args.budget_usd).locked() as journal:
                result = asyncio.run(
                    connect_and_ask(
                        endpoint=args.endpoint,
                        token=token,
                        tenant=str(args.tenant),
                        domain=str(args.domain),
                        question=args.question,
                        conversation_id=str(args.conversation_id) if args.conversation_id else None,
                        request_id=str(args.request_id),
                        journal=journal,
                        model=model,
                    )
                )
            print(json.dumps(result, ensure_ascii=False))
        except Exception as exc:
            # SDK ExceptionGroups and validation errors may contain private inputs.
            code = safe_error_code(exc)
            print(
                json.dumps(
                    {
                        "error": code,
                        "message": "Companion command did not complete; inspect configuration and private journal",
                    }
                )
            )
            raise SystemExit(1) from None
        return
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
