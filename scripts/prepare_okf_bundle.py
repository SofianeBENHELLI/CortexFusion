"""Inspect an OKF ZIP into a private, deterministic import catalog; never publish it.

The catalog preserves source text and declared metadata. Markdown links are candidates
for relationships, not proof of a structural or weighted relation in Cortex.
"""

import argparse
import hashlib
import json
import posixpath
import re
import stat
from collections import Counter
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit
from zipfile import ZipFile

MAX_FILES = 5000
MAX_BYTES = 50 * 1024 * 1024
MAX_DOCUMENT = 2 * 1024 * 1024


def prepare(path: Path):
    fingerprint = hashlib.sha256(path.read_bytes()).hexdigest()
    with ZipFile(path) as archive:
        entries = [info for info in archive.infolist() if not info.is_dir()]
        names = [info.filename for info in entries]
        if len(entries) > MAX_FILES or sum(info.file_size for info in entries) > MAX_BYTES:
            raise ValueError("Bundle exceeds inspection bounds")
        if len(set(names)) != len(names):
            raise ValueError("Duplicate archive paths")
        for info in entries:
            parts = PurePosixPath(info.filename)
            if parts.is_absolute() or ".." in parts.parts or "\\" in info.filename:
                raise ValueError("Unsafe archive path")
            if stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1:
                raise ValueError("Symlink or encrypted entry is unsupported")
            if info.file_size > MAX_DOCUMENT:
                raise ValueError("Document exceeds inspection bounds")
        manifest = json.loads(archive.read("okf/MANIFEST.json"))
        concepts = manifest.get("concepts")
        if not isinstance(concepts, list) or manifest.get("concept_count") != len(concepts):
            raise ValueError("Manifest count differs from entries")
        by_id = {}
        for concept in concepts:
            ident = concept.get("id")
            if not isinstance(ident, str) or not ident or ident in by_id:
                raise ValueError("Missing or duplicate concept identity")
            if not isinstance(concept.get("title"), str) or not concept["title"].strip():
                raise ValueError("Missing concept title")
            expected = "okf/" + ident + ".md"
            if expected not in names or posixpath.normpath(expected) != expected:
                raise ValueError("Manifest concept has no matching safe document")
            by_id[ident] = concept
        catalog, missing = [], []
        for ident, concept in sorted(by_id.items()):
            source_path = "okf/" + ident + ".md"
            raw = archive.read(source_path)
            text = raw.decode("utf-8-sig")
            frontmatter = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)", text, re.S)
            metadata = frontmatter.group(1) if frontmatter else ""
            # Only inspect the top-level scalar; do not execute or interpret embedded instructions.
            status = re.search(r"^status:\s*([^\r\n#]+)", metadata, re.M)
            body = text[frontmatter.end() :] if frontmatter else text
            without_code = re.sub(r"(?m)^(`{3,}|~{3,}).*?^\1\s*$", "", body, flags=re.S)
            links = set()
            for link in re.findall(r"\[[^\]]*\]\(([^)]+)\)", without_code):
                destination = link.split(' "')[0].strip().strip("<>")
                parsed = urlsplit(destination)
                if parsed.scheme or parsed.netloc or not parsed.path:
                    continue
                target = posixpath.normpath(
                    posixpath.join(posixpath.dirname(source_path), unquote(parsed.path))
                )
                if target not in names:
                    missing.append({"source": source_path, "target": destination})
                target_id = target.removeprefix("okf/").removesuffix(".md")
                if target_id in by_id:
                    links.add(target_id)
            catalog.append(
                {
                    **concept,
                    "source_path": source_path,
                    "source_sha256": hashlib.sha256(raw).hexdigest(),
                    "text": text,
                    "body_start": frontmatter.end() if frontmatter else 0,
                    "body_end": len(text),
                    "declared_status": status.group(1).strip().strip("\"'") if status else None,
                    "layer": ident.split("/")[0],
                    "linked_concept_ids": sorted(links),
                }
            )
    report = {
        "archive_sha256": fingerprint,
        "files": len(entries),
        "markdown_files": sum(n.endswith(".md") for n in names),
        "concepts": len(catalog),
        "directed_link_candidates": sum(len(c["linked_concept_ids"]) for c in catalog),
        "layers": dict(sorted(Counter(c["layer"] for c in catalog).items())),
        "types": dict(sorted(Counter(c.get("type", "unknown") for c in catalog).items())),
        "declared_statuses": dict(
            sorted(Counter(c["declared_status"] or "unspecified" for c in catalog).items())
        ),
        "unresolved_local_links": missing,
        "over_concept_body_limit": [
            c["id"] for c in catalog if c["body_end"] - c["body_start"] > 200000
        ],
        "over_relation_limit": [c["id"] for c in catalog if len(c["linked_concept_ids"]) > 100],
        "notice": "Private import preparation. No Cortex approval/publication or automatic maturity, weight, archive or learning event is inferred. Links are inline Markdown reference candidates only; source content is preserved verbatim. Documents beyond the 200,000-character concept contract require an explicit content decision before import.",
    }
    return {
        "schema_version": 1,
        "bundle": manifest.get("bundle", "OKF"),
        "report": report,
        "concepts": catalog,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    catalog = prepare(args.archive)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False) + "\n")
    (args.output / "audit.json").write_text(
        json.dumps(catalog["report"], ensure_ascii=False, indent=2) + "\n"
    )
    print(
        json.dumps(
            {
                k: v
                for k, v in catalog["report"].items()
                if k
                not in {
                    "types",
                    "unresolved_local_links",
                    "over_concept_body_limit",
                    "over_relation_limit",
                }
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print(
        f"Unresolved links: {len(catalog['report']['unresolved_local_links'])}; bodies above 200000: {len(catalog['report']['over_concept_body_limit'])}; links above 100: {len(catalog['report']['over_relation_limit'])}"
    )


if __name__ == "__main__":
    main()
