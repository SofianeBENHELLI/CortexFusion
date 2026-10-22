"""Deterministic synthetic Step 1 workload; preparation only, no publication.

The frozen protocol is docs/product/brain-scale-10000.fr.md. Native source IDs
must come from registered source receipts, never from these fixture source keys.
"""

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

SEED = "cortex-step1-20261004-v1"
ROOT = Path(__file__).resolve().parents[1]


def identity(case, value):
    return str(uuid5(NAMESPACE_URL, f"{SEED}/{case}/{value}"))


def workload(case):
    if case not in {"S20", "S100", "M20", "M100"}:
        raise ValueError("Unknown frozen workload")
    counts = [10000] if case.startswith("S") else [9000, 900, 100]
    dense = case.endswith("100")
    ordinary_index, global_index = 0, 0
    domains, records = [], []
    for domain_index, count in enumerate(counts):
        domain = identity(case, f"domain/{domain_index}")
        domains.append(
            {"id": domain, "name": f"Synthetic {case} domain {domain_index + 1}", "concepts": count}
        )
        ids = [identity(case, f"concept/{domain_index}/{i}") for i in range(count)]
        for local in range(count):
            hub = domain_index == 0 and count - 50 <= local
            if hub:
                degree = 100
            else:
                degree = (
                    (10 if ordinary_index < 5450 else 9)
                    if dense
                    else (2 if ordinary_index < 5050 else 1)
                )
                ordinary_index += 1
            # The first 20 records form a small initial cohort; later records
            # cite only previous cohorts. The longest first cohort (M*/domain3)
            # has 20 x 30k bodies, well below the 1.5 MB review envelope.
            available = max(20, (local // 20) * 20)
            targets = [0] if local != 0 else [1]
            cursor = local + 1
            while len(targets) < degree:
                target = cursor % available
                cursor += 1
                if target != local and target not in targets:
                    targets.append(target)
            length = (
                600
                if global_index < 9000
                else 6000
                if global_index < 9890
                else 30000
                if global_index < 9990
                else 200000
            )
            title = f"Step 1 {case} concept {global_index:05d}"
            prefix = f"Preuve synthétique 🧠 é — {title}. "
            # Body mentions deliberately compete with an exact off-page title.
            phrase = f"Référence textuelle à Step 1 {case} concept 09999. "
            body = (prefix + phrase * (length // len(phrase) + 1))[:length]
            records.append(
                {
                    "domain_id": domain,
                    "concept_id": ids[local],
                    "title": title,
                    "body": body,
                    "body_sha256": hashlib.sha256(body.encode()).hexdigest(),
                    "maturity": "emerging",
                    "source_key": identity(case, f"source/{global_index}"),
                    "location": f"synthetic://{SEED}/{case}/{global_index}",
                    "links": [
                        {
                            "target_id": ids[t],
                            "kind": "associative",
                            "weight": 0.5,
                            "primary": False,
                        }
                        for t in targets
                    ],
                }
            )
            global_index += 1
    summary = {
        "concepts": len(records),
        "sources": len(records),
        "relations": sum(len(r["links"]) for r in records),
        "domain_concepts": counts,
        "body_characters": dict(sorted(Counter(len(r["body"]) for r in records).items())),
        "outgoing_degrees": dict(sorted(Counter(len(r["links"]) for r in records).items())),
    }
    assert summary["concepts"] == 10000 and summary["relations"] == (100000 if dense else 20000)
    return {
        "schema_version": 1,
        "synthetic_only": True,
        "seed": SEED,
        "case": case,
        "domains": domains,
        "records": records,
        "summary": summary,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("case", choices=["S20", "S100", "M20", "M100"])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    path = args.output.resolve()
    if not path.is_relative_to(ROOT / ".runtime/brain") or path.exists():
        raise ValueError("Use a new private runtime output file")
    value = workload(args.case)
    content = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with path.open("xb") as stream:
        path.chmod(0o600)
        stream.write(content)
    print(
        json.dumps(
            {
                "case": args.case,
                "summary": value["summary"],
                "manifest_sha256": hashlib.sha256(content).hexdigest(),
                "bytes": len(content),
                "published": False,
            }
        )
    )


if __name__ == "__main__":
    main()
