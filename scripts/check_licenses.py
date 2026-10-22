"""Metadata gate for installed dependencies; not a complete redistribution/legal audit."""

import json
import re
import subprocess
import sys
from importlib.metadata import distributions
from pathlib import Path

ALLOWED = {
    "MIT",
    "MIT-0",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "PSF-2.0",
    "MIT AND PSF-2.0",
    "Python-2.0",
    "Apache-2.0 OR BSD-3-Clause",
    "Apache-2.0 OR BSD-2-Clause",
}
ALIASES = {"BSD 3-Clause License": "BSD-3-Clause", "MIT No Attribution": "MIT-0"}
# Exact artifact reviewed against its installed license classifiers/files.
OVERRIDES = {("python-dateutil", "2.9.0.post0"): "Apache-2.0 OR BSD-3-Clause"}
# Exact frontend artifacts; notices are shipped in apps/console/public/licenses.
FRONTEND_LICENSES = {
    ("node", "@fontsource/manrope", "5.2.8"): "OFL-1.1",
    ("node", "tslib", "2.8.1"): "0BSD",
}
INTACT_MPL = {("certifi", "2026.7.22")}
# Exact development-only artifacts of the console lint toolchain; never shipped.
LINT_TOOLCHAIN = {
    ("node", "caniuse-lite", "1.0.30001818"): "CC-BY-4.0",  # browserslist data via Babel
    ("node", "minimatch", "10.2.6"): "BlueOak-1.0.0",  # typescript-eslint file matching
}
# Workspace packages; the project license is a separate, deliberately unmade decision.
FIRST_PARTY = {"cortex-core", "cortex-browser-gateway"}
# License terms a Rust crate's SPDX expression may resolve to. Beyond the usual
# permissive set: the Unicode data license (ICU crates), zlib, and the CDLA data
# license of the bundled web PKI root certificates.
RUST_TERMS = {
    "MIT",
    "MIT-0",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "Unicode-3.0",
    "Zlib",
    "CDLA-Permissive-2.0",
}


def inventory():
    rows = {}
    for dist in distributions():
        name, version = dist.metadata["Name"], dist.version
        if name in FIRST_PARTY:
            continue
        declared = (
            dist.metadata.get("License-Expression") or dist.metadata.get("License") or "UNKNOWN"
        )
        license_name = OVERRIDES.get((name.lower(), version), ALIASES.get(declared, declared))
        rows[("python", name, version)] = license_name
    packages = Path("node_modules/.pnpm")
    if not packages.exists():
        raise SystemExit("Install locked Node dependencies before checking licenses")
    for path in list(packages.glob("*/node_modules/*/package.json")) + list(
        packages.glob("*/node_modules/@*/*/package.json")
    ):
        data = json.loads(path.read_text())
        rows[("node", data["name"], data["version"])] = data.get("license", "UNKNOWN")
    return rows


def spdx_allows(expression, terms):
    """True when some OR branch of the expression needs only allowed terms."""
    tokens = re.findall(r"[()]|[^\s()]+", expression.replace("/", " OR "))[::-1]

    def term():
        token = tokens.pop()
        if token == "(":
            value = either()
            if tokens.pop() != ")":
                raise ValueError(expression)
            return value
        if tokens and tokens[-1] == "WITH":
            tokens.pop()
            token += " WITH " + tokens.pop()
        return token in terms

    def both():
        value = term()
        while tokens and tokens[-1] == "AND":
            tokens.pop()
            value = term() and value
        return value

    def either():
        value = both()
        while tokens and tokens[-1] == "OR":
            tokens.pop()
            value = both() or value
        return value

    try:
        return either() and not tokens
    except (IndexError, ValueError):
        return False


def rust_inventory():
    metadata = json.loads(
        subprocess.run(
            ["cargo", "metadata", "--format-version", "1", "--locked"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    )
    first_party = set(metadata["workspace_members"])
    return {
        ("rust", p["name"], p["version"]): p.get("license") or "UNKNOWN"
        for p in metadata["packages"]
        if p["id"] not in first_party
    }


def check_rust():
    rows = rust_inventory()
    failed = [
        f"rust: {name}@{version}: {declared}"
        for (_, name, version), declared in sorted(rows.items())
        if not spdx_allows(declared, RUST_TERMS)
    ]
    if failed:
        raise SystemExit("Unreviewed dependency licenses:\n" + "\n".join(failed))
    print(f"Metadata policy passed for {len(rows)} locked Rust crates on all platforms.")


if __name__ == "__main__" and sys.argv[1:] == ["--rust"]:
    check_rust()
elif __name__ == "__main__":
    rows = inventory()
    failed = []
    for (ecosystem, name, version), declared in sorted(rows.items()):
        allowed = (
            declared in ALLOWED
            or FRONTEND_LICENSES.get((ecosystem, name, version)) == declared
            or LINT_TOOLCHAIN.get((ecosystem, name, version)) == declared
            or (declared == "MPL-2.0" and (name.lower(), version) in INTACT_MPL)
        )
        if not allowed:
            failed.append(f"{ecosystem}: {name}@{version}: {declared}")
    if failed:
        raise SystemExit("Unreviewed dependency licenses:\n" + "\n".join(failed))
    print(
        f"Metadata policy passed for {len(rows)} installed Python/Node dependencies; certifi intact-MPL exception recorded."
    )
