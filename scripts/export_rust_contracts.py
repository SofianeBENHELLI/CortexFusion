"""Export native-only extensions without inventing routes in the Python reference."""

import argparse
import copy
import json
from pathlib import Path

from cortex_core.interactions import EFFECTS, catalog
from cortex_core.mcp_bridge import definitions
from export_frontend_reference import build, render

ROOT = Path(__file__).resolve().parents[1]


def build_extensions():
    source = json.loads((ROOT / "services/rust-core/contracts/extensions.json").read_text())
    baseline = json.loads((ROOT / "packages/contracts/openapi.json").read_text())
    errors = baseline["paths"]["/v1/domains/{domain}/proposals/{proposal_id}/publish"]["post"][
        "responses"
    ]
    spec = {
        "paths": {},
        "components": {"schemas": source["schemas"]},
        "x-cortex-http-confirmation-mode": "required",
    }
    translations = {}
    for definition in source["operations"]:
        action = definition["action_id"]
        if action in translations:
            raise ValueError("Duplicate native action")
        translations[action] = {
            "description": definition["description_fr"],
            "frontend": definition["frontend_fr"],
        }
        meta = {
            "action_id": action,
            "roles": ["owner"],
            "effect": definition["effect"],
            "effect_description": EFFECTS[definition["effect"]],
            "intent_example": definition["intent"],
            "confirmation_policy": "explicit_user_decision"
            if definition["confirmed"]
            else "authorized_user_intent",
            "object_authorization": definition.get(
                "object_authorization",
                "Current owner and current access to all proposal evidence are required; the inventory grants no authority.",
            ),
        }
        parameters = [
            {
                "name": name,
                "in": "path",
                "required": True,
                "schema": {"type": "string", "format": "uuid"},
            }
            for name in definition["path_parameters"]
        ]
        parameters.append(
            {
                "name": "x-tenant-id",
                "in": "header",
                "required": True,
                "schema": {"type": "string", "format": "uuid"},
            }
        )
        parameters.extend(
            {"name": name, "in": "query", "required": False, "schema": schema}
            for name, schema in definition.get("query", {}).items()
        )
        operation = {
            "operationId": action,
            "description": definition["description_fr"],
            "x-cortex-interaction": meta,
            "x-cortex-runtime": "rust",
            "security": [{"BearerAuth": []}],
            "parameters": parameters,
            "responses": {
                str(definition["status"]): {
                    "description": "Durable command receipt"
                    if definition["confirmed"]
                    else "Authorized state",
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/" + definition["output"]}
                        }
                    },
                },
                **{
                    code: copy.deepcopy(value)
                    for code, value in errors.items()
                    if not code.startswith("2") and (code != "428" or definition["confirmed"])
                },
            },
        }
        if "input" in definition:
            operation["requestBody"] = {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {"$ref": "#/components/schemas/" + definition["input"]}
                    }
                },
            }
        methods = spec["paths"].setdefault(definition["path"], {})
        if definition["method"].lower() in methods or definition["path"] in baseline["paths"]:
            raise ValueError("Native extension collides with an existing route")
        methods[definition["method"].lower()] = operation
    inventory = catalog(spec)
    tools = {
        "tools": [
            entry["tool"].model_dump(mode="json", exclude_none=True)
            for entry in definitions(spec).values()
        ]
    }
    functional = build(spec, inventory, translations, tools)
    return {
        "version": "1",
        "paths": spec["paths"],
        "schemas": source["schemas"],
        "interactions": inventory["items"],
        "tools": tools["tools"],
        "functional": functional,
    }


def render_native(functional):
    document = render(functional)
    start = document.index("## Règles communes")
    document = """# Extensions natives Rust — import et reprise des graphes

Généré par `scripts/export_rust_contracts.py` depuis `services/rust-core/contracts/extensions.json`. Ne pas modifier directement. Le catalogue machine est `packages/contracts/rust-extensions.json` (section `functional` pour les descriptions françaises).

Ces **7 opérations HTTP et MCP** complètent les 79 opérations de référence. Lire le [guide frontend](frontend-guide.fr.md) et les contrats servis par le runtime Rust.

""" + document[start:]
    lines = document.splitlines()
    for index, line in enumerate(lines):
        if line.startswith("- Les actions sensibles requièrent"):
            lines[index] = (
                "- Les actions sensibles exigent une confirmation signée de l’hôte authentifié via `X-Cortex-Confirmation`, en HTTP comme en MCP. Le runtime Rust ne propose pas de mode qui supprime cette confirmation."
            )
    return "\n".join(lines) + "\n"


def combine_functional(baseline, extension, tools):
    """One native frontend/companion reference; no runtime authority or new route."""
    result = copy.deepcopy(baseline)
    result["items"].extend(copy.deepcopy(extension["functional"]["items"]))
    for key in ("action_id", "mcp_tool"):
        if len({item[key] for item in result["items"]}) != len(result["items"]):
            raise ValueError("Duplicate native functional " + key)
    if len({(item["method"], item["path"]) for item in result["items"]}) != len(result["items"]):
        raise ValueError("Duplicate native functional route")
    for name, schema in extension["schemas"].items():
        if name in result["schemas"]:
            raise ValueError("Native functional schema collision")
        result["schemas"][name] = copy.deepcopy(schema)
    result["mcp_tools"] = copy.deepcopy(tools["tools"] + extension["tools"])
    # HTTP references already use the OpenAPI #/components/schemas scope.
    # MCP inputSchema values remain independent JSON Schema documents.
    result["components"] = {"schemas": result.pop("schemas")}
    names = {tool["name"] for tool in result["mcp_tools"]}
    if len(names) != len(result["mcp_tools"]):
        raise ValueError("Duplicate native MCP tool")
    if any(item["mcp_tool"] not in names for item in result["items"]):
        raise ValueError("Native functional action without MCP tool")
    result.update(
        {
            "runtime": "rust",
            "notice": "Catalogue documentaire Rust complet ; aucune autorisation individuelle n'est accordée. Les opérations sensibles exigent une confirmation signée en HTTP comme en MCP.",
            "http_confirmation_mode": "required",
            "http_operations_count": len(result["items"]),
            "mcp_tools_count": len(result["mcp_tools"]),
            "schema_resolution": {
                "http": "Resolve #/components/schemas references against this document.",
                "mcp": "Evaluate each tool inputSchema/outputSchema as its own JSON Schema document; its $defs references are local to that schema.",
            },
        }
    )
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    extension = build_extensions()
    functional = combine_functional(
        json.loads((ROOT / "packages/contracts/functional-interactions.fr.json").read_text()),
        extension,
        json.loads((ROOT / "packages/contracts/mcp-tools.json").read_text()),
    )
    artifacts = {
        "packages/contracts/rust-extensions.json": json.dumps(
            extension, ensure_ascii=False, indent=2
        )
        + "\n",
        "docs/rust-extensions.fr.md": render_native(extension["functional"]),
        "packages/contracts/functional-interactions.rust.fr.json": json.dumps(
            functional, ensure_ascii=False, indent=2
        )
        + "\n",
    }
    for name, schema in extension["schemas"].items():
        refs = set()

        def standalone(value, refs=refs):
            if isinstance(value, dict):
                result = {key: standalone(item) for key, item in value.items()}
                if "$ref" in result:
                    target = result["$ref"].removeprefix("#/components/schemas/")
                    if target not in extension["schemas"]:
                        raise ValueError("Unknown native schema reference")
                    refs.add(target)
                    result["$ref"] = "#/$defs/" + target
                return result
            if isinstance(value, list):
                return [standalone(item) for item in value]
            return value

        wire = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "title": name,
            **standalone(schema),
        }
        definitions = {}
        while refs - definitions.keys():
            target = sorted(refs - definitions.keys())[0]
            definitions[target] = standalone(extension["schemas"][target])
        if definitions:
            wire["$defs"] = definitions
        artifacts[f"packages/contracts/schema/{name}.json"] = (
            json.dumps(wire, ensure_ascii=False, indent=2) + "\n"
        )
    for name, content in artifacts.items():
        path = ROOT / name
        if args.check:
            if not path.exists() or path.read_text() != content:
                raise SystemExit("Native contract drift: " + name)
        else:
            path.write_text(content)
    print(f"{len(extension['interactions'])} native-only HTTP/MCP extensions verified/exported")


if __name__ == "__main__":
    main()
