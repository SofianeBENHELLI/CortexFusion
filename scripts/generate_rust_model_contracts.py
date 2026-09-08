"""Regenerate native prompt/schema and decimal tables from locked Python references; no network."""

import json
import unicodedata
from pathlib import Path

from cortex_core.synthesis_model import OpenRouterSynthesis
from pydantic import SecretStr

root = Path(__file__).resolve().parents[1] / "services/rust-core/src"
model = OpenRouterSynthesis("placeholder", SecretStr("synthetic-not-a-secret"))
(root / "synthesis-template.json").write_text(
    json.dumps(model.prepare("", {"citations": []}), ensure_ascii=False, indent=2) + "\n"
)
ranges = []
for n in range(0x110000):
    if unicodedata.category(chr(n)) == "Nd":
        if ranges and ranges[-1][1] + 1 == n:
            ranges[-1][1] = n
        else:
            ranges.append([n, n])
(root / "decimal-unicode.json").write_text(json.dumps(ranges) + "\n")
