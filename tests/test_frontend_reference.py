import copy
import importlib.util
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "frontend_reference", ROOT / "scripts/export_frontend_reference.py"
)
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)


def inputs():
    return [
        json.loads((ROOT / name).read_text())
        for name in (
            "packages/contracts/openapi.json",
            "packages/contracts/interactions.json",
            "docs/fr/actions.json",
            "packages/contracts/mcp-tools.json",
        )
    ]


@pytest.mark.parametrize(
    "change", ["missing", "obsolete", "empty", "mcp_missing", "wrong_operation"]
)
def test_french_contract_rejects_incomplete_or_misaligned_documentation(change):
    api, inventory, translations, tools = inputs()
    action = inventory["items"][0]["action_id"]
    if change == "missing":
        translations.pop(action)
    elif change == "obsolete":
        translations["removed.action"] = copy.deepcopy(translations[action])
    elif change == "empty":
        translations[action]["description"] = " "
    elif change == "mcp_missing":
        name = "api_" + action.replace(".", "_")
        tools["tools"] = [t for t in tools["tools"] if t["name"] != name]
    else:
        item = inventory["items"][0]
        api["paths"][item["path"]][item["method"].lower()]["operationId"] = "wrong"
    with pytest.raises(ValueError):
        reference.build(api, inventory, translations, tools)


def test_generated_reference_has_resolvable_anchors_and_preserves_wire_constraints():
    document = reference.build(*inputs())
    rendered = reference.render(document)
    anchors = set(re.findall(r'<a id="([^"]+)">', rendered))
    for link in re.findall(r"\]\(#([^)]+)\)", rendered):
        assert link in anchors
    raw = json.loads((ROOT / "packages/contracts/openapi.json").read_text())
    assert document["schemas"] == raw["components"]["schemas"]
    for item in document["items"]:
        operation = raw["paths"][item["path"]][item["method"].lower()]
        assert item["request_body"] == operation.get("requestBody")
        assert item["parameters"] == operation.get("parameters", [])
        for code, response in operation["responses"].items():
            if code.startswith("2"):
                assert item["responses"][code] == response
    compensation = next(i for i in document["items"] if i["action_id"] == "commits.compensate")
    assert compensation["mcp_confirmation_required"] is True
