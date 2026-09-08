"""Reproduce synthetic companion accounting scenarios and save a machine-readable report."""

import argparse
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path

import pytest


class Report:
    def __init__(self):
        self.results = []

    def pytest_runtest_logreport(self, report):
        if report.when == "call" or report.failed:
            properties = dict(report.user_properties)
            self.results.append(
                {
                    "test": report.nodeid,
                    "phase": report.when,
                    "outcome": report.outcome,
                    "duration_seconds": round(report.duration, 6),
                    **{k: properties[k] for k in ("scenario", "summary") if k in properties},
                }
            )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("artifacts/feedback-evaluation.json"))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    report = Report()
    result = pytest.main(
        [
            "-q",
            str(root / "tests/test_feedback_metrics.py"),
            str(root / "tests/test_feedback_signals.py"),
        ],
        plugins=[report],
    )
    commit = (
        subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True, check=False
        ).stdout.strip()
        or None
    )
    dirty = subprocess.run(
        ["git", "status", "--porcelain"], cwd=root, capture_output=True, text=True, check=False
    ).stdout.strip()
    output = {
        "generated_at": datetime.now(UTC).isoformat(),
        "scope": "Synthetic backend accounting and authorization; not model quality, calibrated satisfaction or enterprise relevance.",
        "model_calls": 0,
        "git_commit": commit,
        "working_tree_dirty": bool(dirty),
        "pytest_exit_code": int(result),
        "results": report.results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(f"Feedback evaluation report: {args.output.resolve()}")
    raise SystemExit(result)


if __name__ == "__main__":
    main()
