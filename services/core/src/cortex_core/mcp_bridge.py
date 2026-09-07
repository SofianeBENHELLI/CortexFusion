"""Exhaustive MCP facade over the same in-process ASGI HTTP boundary."""

import base64
import copy
import json
from urllib.parse import quote, urlencode

import jsonschema
from mcp.types import CallToolResult, TextContent, Tool, ToolAnnotations
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from .auth import CoreError
from .confirmations import ConfirmationVerifier, command_hash

MCP_ERROR = {
    "type": "object",
    "properties": {
        "error": {"type": "string"},
        "message": {"type": "string"},
        "details": {"type": "array", "items": {"type": "object"}},
    },
    "required": ["error"],
    "additionalProperties": False,
}
MCP_CONFIRMATION = {
    "type": "object",
    "properties": {
        "action": {"type": "string"},
        "command_hash": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
        "transport_header": {"const": "X-Cortex-Confirmation"},
        "max_lifetime_seconds": {"const": 300},
    },
    "required": ["action", "command_hash", "transport_header", "max_lifetime_seconds"],
    "additionalProperties": False,
}


def standalone(schema, components):
    result = copy.deepcopy(schema)
    definitions = {}

    def walk(node):
        if isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            ref = node.get("$ref", "")
            if ref.startswith("#/components/schemas/"):
                name = ref.rsplit("/", 1)[-1]
                node["$ref"] = "#/$defs/" + name
                if name not in definitions:
                    definitions[name] = copy.deepcopy(components[name])
                    walk(definitions[name])
            for key, item in node.items():
                if key != "$ref":
                    walk(item)

    walk(result)
    if definitions:
        result["$defs"] = definitions
    return result


def definitions(spec):
    result = {}
    for path, methods in spec["paths"].items():
        for method, operation in methods.items():
            meta = operation["x-cortex-interaction"]
            properties, required = {}, []
            for location in ("path", "query", "header"):
                params = [
                    p
                    for p in operation.get("parameters", [])
                    if p["in"] == location and p["name"] not in ("authorization", "x-tenant-id")
                ]
                if not params:
                    continue
                needed = [p["name"] for p in params if p.get("required")]
                properties[location] = {
                    "type": "object",
                    "properties": {p["name"]: p["schema"] for p in params},
                    "additionalProperties": False,
                    "required": needed,
                }
                if needed:
                    required.append(location)
            body = operation.get("requestBody")
            if body:
                properties["body"] = body["content"]["application/json"]["schema"]
                if body.get("required"):
                    required.append("body")
            schema = standalone(
                {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                    "additionalProperties": False,
                },
                spec["components"]["schemas"],
            )
            name = "api_" + operation["operationId"].replace(".", "_")
            sensitive = (
                meta["confirmation_policy"] == "explicit_user_decision"
                or meta["action_id"] == "commits.compensate"
            )
            success = next(
                response
                for code, response in operation["responses"].items()
                if code.startswith("2")
            )
            response_content = success.get("content", {})
            if "application/json" in response_content:
                output = response_content["application/json"]["schema"]
            else:
                output = {
                    "type": "object",
                    "properties": {"media_type": {"type": "string"}, "base64": {"type": "string"}},
                    "required": ["media_type", "base64"],
                    "additionalProperties": False,
                }
            error_ref = {"$ref": "#/components/schemas/MCPError"}
            envelope = {
                "type": "object",
                "properties": {
                    "http_status": {"type": "integer"},
                    "data": {"anyOf": [output, error_ref]},
                },
                "required": ["http_status", "data"],
                "additionalProperties": False,
                "oneOf": [
                    {
                        "properties": {
                            "http_status": {
                                "enum": [
                                    int(c) for c in operation["responses"] if c.startswith("2")
                                ]
                            },
                            "data": output,
                        },
                        "not": {"required": ["confirmation_request"]},
                    },
                    {
                        "properties": {
                            "http_status": {"minimum": 400, "maximum": 599},
                            "data": error_ref,
                        }
                    },
                ],
            }
            if sensitive:
                envelope["properties"]["confirmation_request"] = {
                    "$ref": "#/components/schemas/MCPConfirmationRequest"
                }
                envelope["allOf"] = [
                    {
                        "if": {"required": ["confirmation_request"]},
                        "then": {"properties": {"http_status": {"const": 428}}},
                    }
                ]
            output_schema = standalone(
                envelope,
                {
                    **spec["components"]["schemas"],
                    "MCPError": MCP_ERROR,
                    "MCPConfirmationRequest": MCP_CONFIRMATION,
                },
            )
            tool = Tool(
                name=name,
                description=operation["description"]
                + (
                    " Requires a trusted-host signed confirmation header bound to these exact arguments."
                    if sensitive
                    else ""
                ),
                inputSchema=schema,
                outputSchema=output_schema,
                annotations=ToolAnnotations(
                    readOnlyHint=method == "get",
                    destructiveHint=meta["effect"] in ("trusted", "access", "rebuild"),
                    openWorldHint=meta["effect"] == "model",
                ),
            )
            result[name] = {
                "tool": tool,
                "method": method.upper(),
                "path": path,
                "action": meta["action_id"],
                "sensitive": sensitive,
                "roles": meta["roles"],
            }
    return result


async def dispatch(app, definition, arguments, headers):
    path = definition["path"]
    for key, val in arguments.get("path", {}).items():
        path = path.replace("{" + key + "}", quote(str(val), safe=""))
    forwarded = {key: headers[key] for key in ("authorization", "x-tenant-id") if key in headers}
    forwarded.update(arguments.get("header", {}))
    forwarded["content-type"] = "application/json"
    body = json.dumps(arguments["body"]).encode() if "body" in arguments else b""
    query = {
        k: str(v).lower() if isinstance(v, bool) else str(v)
        for k, v in arguments.get("query", {}).items()
        if v is not None
    }
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": definition["method"],
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": urlencode(query).encode(),
        "root_path": "",
        "headers": [(k.lower().encode(), v.encode()) for k, v in forwarded.items()],
        "client": ("127.0.0.1", 0),
        "server": ("localhost", 8000),
    }
    messages = []
    delivered = False

    async def receive():
        nonlocal delivered
        if not delivered:
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message):
        messages.append(message)

    await app(scope, receive, send)
    start = next(m for m in messages if m["type"] == "http.response.start")
    raw = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
    response_headers = dict(start["headers"])
    if b"application/json" in response_headers.get(b"content-type", b""):
        data = json.loads(raw)
    else:
        data = {
            "media_type": response_headers.get(
                b"content-type", b"application/octet-stream"
            ).decode(),
            "base64": base64.b64encode(raw).decode(),
        }
    return {"http_status": start["status"], "data": data}


def install_bridge(app, server, auth, settings):
    legacy_list, legacy_call = server.list_tools, server.call_tool
    verifier = ConfirmationVerifier(settings.confirmation_public_key_file, app.state.db)

    def inventory():
        return definitions(app.openapi())

    async def list_tools():
        return await legacy_list() + [entry["tool"] for entry in inventory().values()]

    async def call_tool(name, arguments):
        if not name.startswith("api_"):
            try:
                return await legacy_call(name, arguments)
            except Exception as exc:
                error = {
                    "error": "MCP_OPERATION_FAILED",
                    "message": "The operation did not complete; inspect state before retrying",
                }
                # FastMCP wraps function errors; preserve safe business codes, never raw SDK/DB text.
                cause = exc
                for _ in range(8):
                    if isinstance(cause, CoreError):
                        error = {"error": cause.code, "message": cause.message}
                        break
                    if isinstance(cause, ValidationError):
                        error = {
                            "error": "VALIDATION_FAILED",
                            "message": "Arguments do not match the tool contract",
                        }
                        break
                    cause = cause.__cause__
                    if cause is None:
                        break
                return CallToolResult(
                    content=[TextContent(type="text", text=json.dumps(error))], isError=True
                )
        try:
            entry = inventory().get(name)
            if entry is None:
                raise CoreError("UNKNOWN_TOOL", "Unknown action", 404)
            try:
                jsonschema.validate(
                    arguments, entry["tool"].inputSchema, format_checker=jsonschema.FormatChecker()
                )
            except jsonschema.ValidationError:
                raise CoreError(
                    "VALIDATION_FAILED", "Arguments do not match the tool contract", 422
                ) from None
            request = server.get_context().request_context.request
            headers = dict(request.headers) if request else {}

            def authorize():
                p = auth.authenticate(headers.get("authorization"), headers.get("x-tenant-id"))
                if entry["sensitive"]:
                    domain = arguments.get("path", {}).get("domain")
                    with app.state.db.transaction(p, domain, owner=entry["roles"] == ["owner"]):
                        pass
                    verifier.consume(
                        p,
                        domain,
                        entry["action"],
                        arguments,
                        headers.get("x-cortex-confirmation"),
                        owner=entry["roles"] == ["owner"],
                    )

            await run_in_threadpool(authorize)
            result = await dispatch(app, entry, arguments, headers)
            return CallToolResult(
                content=[TextContent(type="text", text=json.dumps(result))],
                structuredContent=result,
                isError=result["http_status"] >= 400,
            )
        except CoreError as exc:
            result = {
                "http_status": exc.status,
                "data": {"error": exc.code, "message": exc.message},
            }
            if exc.code == "CONFIRMATION_REQUIRED":
                result["confirmation_request"] = {
                    "action": entry["action"],
                    "command_hash": command_hash(entry["action"], arguments),
                    "transport_header": "X-Cortex-Confirmation",
                    "max_lifetime_seconds": 300,
                }
            return CallToolResult(
                content=[TextContent(type="text", text=json.dumps(result))],
                structuredContent=result,
                isError=True,
            )

        except Exception:
            result = {
                "http_status": 503,
                "data": {
                    "error": "MCP_OPERATION_FAILED",
                    "message": "The operation did not complete; inspect state before retrying",
                },
            }
            return CallToolResult(
                content=[TextContent(type="text", text=json.dumps(result))],
                structuredContent=result,
                isError=True,
            )

    server.list_tools = list_tools
    server.call_tool = call_tool
    # Override transport handlers as well as the direct/export interfaces.
    server._mcp_server.list_tools()(list_tools)
    server._mcp_server.call_tool(validate_input=False)(call_tool)
