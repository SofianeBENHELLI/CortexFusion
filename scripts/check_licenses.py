"""Metadata gate for installed dependencies; not a complete redistribution/legal audit."""

import json
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
INTACT_MPL = {("certifi", "2026.7.22")}


def inventory():
    rows = {}
    for dist in distributions():
        name, version = dist.metadata["Name"], dist.version
        if name == "cortex-core":
            continue  # Project license is a separate, deliberately unmade decision.
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


if __name__ == "__main__":
    rows = inventory()
    failed = []
    for (ecosystem, name, version), declared in sorted(rows.items()):
        allowed = declared in ALLOWED or (
            declared == "MPL-2.0" and (name.lower(), version) in INTACT_MPL
        )
        if not allowed:
            failed.append(f"{ecosystem}: {name}@{version}: {declared}")
    if failed:
        raise SystemExit("Unreviewed dependency licenses:\n" + "\n".join(failed))
    print(
        f"Metadata policy passed for {len(rows)} installed Python/Node dependencies; certifi intact-MPL exception recorded."
    )
