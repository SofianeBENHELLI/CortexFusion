"""The single native reference must retain every route, tool and schema."""

import copy
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from export_rust_contracts import combine_functional  # noqa: E402


def inputs():
    return [
        json.loads((ROOT / path).read_text())
        for path in (
            "packages/contracts/functional-interactions.fr.json",
            "packages/contracts/rust-extensions.json",
            "packages/contracts/mcp-tools.json",
        )
    ]


def test_native_bundle_preserves_complete_functional_and_mcp_contracts_without_mutation():
    baseline, extension, tools = inputs()
    before = copy.deepcopy((baseline, extension, tools))
    bundle = combine_functional(baseline, extension, tools)
    assert (baseline, extension, tools) == before
    assert bundle == json.loads(
        (ROOT / "packages/contracts/functional-interactions.rust.fr.json").read_text()
    )
    assert bundle["items"] == baseline["items"] + extension["functional"]["items"]
    assert bundle["components"]["schemas"] == {**baseline["schemas"], **extension["schemas"]}
    assert bundle["mcp_tools"] == tools["tools"] + extension["tools"]
    assert bundle["http_operations_count"] == 87 and bundle["mcp_tools_count"] == 103
    assert bundle["http_confirmation_mode"] == "required" and bundle["runtime"] == "rust"


def test_native_http_json_pointers_and_independent_mcp_schema_pointers_resolve():
    bundle = combine_functional(*inputs())

    def check(node, root):
        if isinstance(node, dict):
            if "$ref" in node:
                reference = node["$ref"]
                assert reference.startswith("#/"), "Unexpected external schema dependency"
                target = root
                for token in reference[2:].split("/"):
                    target = target[token.replace("~1", "/").replace("~0", "~")]
                assert isinstance(target, dict)
            for value in node.values():
                check(value, root)
        elif isinstance(node, list):
            for value in node:
                check(value, root)

    check(bundle["items"], bundle)
    check(bundle["components"], bundle)
    for tool in bundle["mcp_tools"]:
        for field in ["inputSchema", "outputSchema"]:
            if field in tool:
                check(tool[field], tool[field])


@pytest.mark.parametrize("fault", ["action_id", "mcp_tool", "route", "schema", "tool", "missing"])
def test_native_bundle_refuses_collisions_and_missing_mcp_mapping(fault):
    baseline, extension, tools = inputs()
    if fault in {"action_id", "mcp_tool"}:
        extension["functional"]["items"][0][fault] = baseline["items"][0][fault]
    elif fault == "route":
        for field in ["path", "method"]:
            extension["functional"]["items"][0][field] = baseline["items"][0][field]
    elif fault == "schema":
        extension["schemas"][next(iter(baseline["schemas"]))] = {}
    elif fault == "tool":
        extension["tools"][0]["name"] = tools["tools"][0]["name"]
    else:
        name = baseline["items"][0]["mcp_tool"]
        tools["tools"] = [tool for tool in tools["tools"] if tool["name"] != name]
    with pytest.raises(ValueError):
        combine_functional(baseline, extension, tools)
