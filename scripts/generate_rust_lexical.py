"""Reproduce Rust lexical tables from the Python 3.12 / Unicode 15.0 reference."""

import json
import re
import unicodedata
from pathlib import Path


def main():
    if unicodedata.unidata_version != "15.0.0":
        raise RuntimeError("Use the frozen Python reference with Unicode 15.0.0")
    folds, ranges = {}, []
    start = end = None
    for point in range(0x110000):
        char = chr(point)
        if char.casefold() != char:
            folds[str(point)] = char.casefold()
        if re.fullmatch(r"\w", char):
            if start is None:
                start = point
            end = point
        elif start is not None:
            ranges.append([start, end])
            start = None
    if start is not None:
        ranges.append([start, end])
    target = Path(__file__).parents[1] / "services/rust-core/src/lexical-unicode.json"
    target.write_text(
        json.dumps(
            {
                "unicode_version": unicodedata.unidata_version,
                "casefold": folds,
                "word_ranges": ranges,
            },
            ensure_ascii=True,
            separators=(",", ":"),
        )
        + "\n"
    )


if __name__ == "__main__":
    main()
