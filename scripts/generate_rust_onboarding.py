"""Copy public MCP guidance and declaration metadata from the compatibility reference."""

import ast
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
module = ast.parse((root / "services/core/src/cortex_core/mcp_onboarding.py").read_text())
guide = next(
    ast.literal_eval(n.value)
    for n in module.body
    if isinstance(n, ast.Assign)
    and any(isinstance(t, ast.Name) and t.id == "GUIDE" for t in n.targets)
)
workflow_module = ast.parse(
    (root / "services/core/src/cortex_core/companion_guides.py").read_text()
)
workflow_values = {}
for n in workflow_module.body:
    if not isinstance(n, ast.Assign) or not isinstance(n.targets[0], ast.Name):
        continue
    key = n.targets[0].id
    if key == "GUIDES":
        workflow_values[key] = ast.literal_eval(n.value)
    elif key == "CATALOG":
        workflow_values[key] = {
            ast.literal_eval(k): workflow_values["GUIDES"]
            if isinstance(v, ast.Name) and v.id == "GUIDES"
            else ast.literal_eval(v)
            for k, v in zip(n.value.keys, n.value.values, strict=True)
        }
out = {
    "guide": guide,
    "workflows": workflow_values["CATALOG"],
    "resources": [],
    "resourceTemplates": [],
    "prompts": [],
}
for node in ast.walk(module):
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        continue
    for d in node.decorator_list:
        if not isinstance(d, ast.Call) or not isinstance(d.func, ast.Attribute):
            continue
        if d.func.attr not in ("resource", "prompt"):
            continue
        values = {k.arg: ast.literal_eval(k.value) for k in d.keywords}
        if d.func.attr == "resource":
            uri = ast.literal_eval(d.args[0])
            template = "{" in uri
            item = {
                "uriTemplate" if template else "uri": uri,
                "name": values["name"],
                "description": values["description"],
                "mimeType": values["mime_type"],
            }
            out["resourceTemplates" if template else "resources"].append(item)
        else:
            out["prompts"].append(
                {
                    "name": values["name"],
                    "description": values["description"],
                    "arguments": [{"name": a.arg, "required": True} for a in node.args.args],
                }
            )
(root / "services/rust-core/src/onboarding.json").write_text(
    json.dumps(out, ensure_ascii=False, indent=2) + "\n"
)
