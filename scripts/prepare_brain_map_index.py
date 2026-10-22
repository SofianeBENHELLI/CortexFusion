"""Prepare a private read-only documentary navigation index; never publishes links."""

import argparse
import json
from pathlib import Path

from scripts.okf_workspace import DIRECTORY, configuration, private_file
from scripts.prepare_okf_ingestion import canonical, digest


def build(manifest, tenant, domain):
    unsigned = {k: v for k, v in manifest.items() if k != "manifest_sha256"}
    if digest(canonical(unsigned)) != manifest["manifest_sha256"]:
        raise ValueError("Manifest fingerprint differs")
    sources = {s["key"]: s for s in manifest["sources"]}
    nodes = []
    for c in manifest["concepts"]:
        m = c["source_metadata"]
        nodes.append(
            {
                "id": c["concept_id"],
                "body_hash": c["body_sha256"],
                "source_hashes": sorted(
                    {sources[s["source_key"]]["content_sha256"] for s in c["sources"]}
                ),
                "group": str(m.get("section") or m.get("type") or "Concepts"),
                "territory": str(m.get("layer") or "Savoir"),
            }
        )
    return {
        "tenant": tenant,
        "domain": domain,
        "nodes": nodes,
        "references": [
            [r["origin_concept_id"], r["target_concept_id"]] for r in manifest["references"]
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    cfg = configuration()
    result = build(json.loads(args.manifest.read_text()), cfg["tenant"], cfg["domain"])
    destination = DIRECTORY / "map-index.json"
    private_file(destination, json.dumps(result, ensure_ascii=False))
    print(
        json.dumps(
            {
                "nodes": len(result["nodes"]),
                "references": len(result["references"]),
                "private_file": str(destination),
            }
        )
    )
