"""Export and verify the public wire schemas from the typed contract source."""

import argparse
import json
from pathlib import Path

from cortex_core.contracts import CONTRACTS

root = Path(__file__).resolve().parents[1] / "packages" / "contracts" / "schema"
parser = argparse.ArgumentParser()
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
for cls in CONTRACTS:
    content = (
        json.dumps(
            {"$schema": "https://json-schema.org/draft/2020-12/schema", **cls.model_json_schema()},
            indent=2,
        )
        + "\n"
    )
    path = root / f"{cls.__name__}.json"
    if args.check:
        if not path.exists() or path.read_text() != content:
            raise SystemExit(f"Schema drift: {path.name}; run scripts/export_contracts.py")
    else:
        path.write_text(content)
print(f"{'Verified' if args.check else 'Exported'} {len(CONTRACTS)} schemas")
