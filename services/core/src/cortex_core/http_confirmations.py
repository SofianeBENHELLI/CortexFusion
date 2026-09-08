"""Confirm sensitive direct HTTP actions; MCP passes an in-process proof, never a header bypass."""

import json

import jsonschema
from fastapi import Request
from starlette.concurrency import run_in_threadpool

from .auth import CoreError
from .confirmations import ConfirmationVerifier, command_hash
from .interactions import REGISTRY, normalized


class HTTPConfirmationGuard:
    def __init__(self, settings, auth, db):
        self.mode = settings.http_confirmation_mode
        self.auth = auth
        self.db = db
        self.verifier = ConfirmationVerifier(settings.confirmation_public_key_file, db)
        self.bridge_proof = object()

    async def __call__(self, request: Request):
        route = request.scope.get("route")
        if not route or not hasattr(route, "path"):
            return
        meta = REGISTRY.get(normalized(request.method, route.path))
        if not meta or meta["confirmation_policy"] != "explicit_user_decision":
            return
        proof = request.scope.get("cortex.confirmed")
        if proof == (self.bridge_proof, meta["action_id"]):
            return
        if self.mode == "trusted_host":
            return

        # Import lazily: the same standalone schema defines the signed argument shape.
        from .mcp_bridge import definitions

        entry = definitions(request.app.openapi())["api_" + meta["action_id"].replace(".", "_")]
        schema = entry["tool"].inputSchema
        arguments = {}
        if request.path_params:
            arguments["path"] = {k: str(v) for k, v in request.path_params.items()}
        if request.query_params:
            # No sensitive query parameters currently exist. Do not silently ignore extras.
            arguments["query"] = dict(request.query_params)
        if "header" in schema["properties"]:
            selected = {
                key: request.headers[key]
                for key in schema["properties"]["header"]["properties"]
                if key in request.headers
            }
            if selected:
                arguments["header"] = selected
        body = await request.body()
        if body:
            try:
                arguments["body"] = json.loads(body)
            except (ValueError, UnicodeDecodeError):
                raise CoreError("VALIDATION_FAILED", "Invalid JSON body", 422) from None
        try:
            jsonschema.validate(arguments, schema, format_checker=jsonschema.FormatChecker())
        except jsonschema.ValidationError:
            raise CoreError(
                "VALIDATION_FAILED", "Arguments do not match the action contract", 422
            ) from None

        def verify():
            p = self.auth.authenticate(
                request.headers.get("authorization"), request.headers.get("x-tenant-id")
            )
            domain = arguments.get("path", {}).get("domain")
            owner = meta["roles"] == ["owner"]
            with self.db.transaction(p, domain, owner=owner):
                pass
            self.verifier.consume(
                p,
                domain,
                meta["action_id"],
                arguments,
                request.headers.get("x-cortex-confirmation"),
                owner=owner,
            )

        try:
            await run_in_threadpool(verify)
        except CoreError as exc:
            if exc.code == "CONFIRMATION_REQUIRED":
                exc.confirmation_request = {
                    "action": meta["action_id"],
                    "command_hash": command_hash(meta["action_id"], arguments),
                    "transport_header": "X-Cortex-Confirmation",
                    "max_lifetime_seconds": 300,
                }
            raise
