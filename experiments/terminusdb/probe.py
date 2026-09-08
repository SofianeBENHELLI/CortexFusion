"""Isolated, synthetic TerminusDB spike. Never connects to CortexFusion storage."""

import argparse
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import httpx

SOURCE_COMMIT = "57f2093baeafd65e16004e84b7b58e0c5cf72858"
SCHEMA = [
    {"@id": "Concept", "@type": "Class", "label": "xsd:string"},
    {"@id": "Evidence", "@type": "Class", "locator": "xsd:string"},
    {"@id": "Owner", "@type": "Class", "label": "xsd:string"},
    {
        "@id": "KnowledgeAtom",
        "@type": "Class",
        "subject": "Concept",
        "predicate": "xsd:string",
        "object": "Concept",
        "context": "xsd:string",
        "evidence": "Evidence",
        "owner": "Owner",
        "business_version": "xsd:integer",
    },
]


def semantic_conflicts(atoms):
    """One deliberately narrow rule; no probabilistic or global conflict claim."""
    buckets = {}
    for atom in atoms:
        key = (atom["subject"], atom["object"], atom["context"])
        buckets.setdefault(key, set()).add(atom["predicate"])
    return [
        {"subject": s, "object": o, "context": c, "rule": "supports_vs_incompatible_v1"}
        for (s, o, c), predicates in sorted(buckets.items())
        if {"SUPPORTS", "INCOMPATIBLE_WITH"} <= predicates
    ]


class SpikeFailure(RuntimeError):
    pass


class TerminusProbe:
    """Private engine boundary for this experiment; not a product repository API."""

    def __init__(self, base_url, password, database=None, transport=None):
        url = urlsplit(base_url)
        if (
            url.scheme != "http"
            or url.hostname not in ("127.0.0.1", "localhost", "::1")
            or url.username
            or url.password
            or url.query
            or url.fragment
            or url.path not in ("", "/")
        ):
            raise ValueError("This synthetic probe requires a local HTTP engine")
        self.database = database or "cortex_spike_" + uuid4().hex
        if not re.fullmatch(r"cortex_spike_[a-z0-9]{8,40}", self.database):
            raise ValueError("Use a fresh synthetic spike database name")
        self.root = "admin/" + self.database
        self.client = httpx.Client(
            base_url=base_url,
            auth=("admin", password),
            timeout=20,
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        )

    def close(self):
        self.client.close()

    def request(self, method, endpoint, *, expected=(200,), **kwargs):
        try:
            response = self.client.request(method, "/api/" + endpoint, **kwargs)
        except httpx.HTTPError:
            raise SpikeFailure("Engine transport failed; no automatic mutation retry") from None
        if response.status_code not in expected:
            raise SpikeFailure(f"Engine operation {method} failed with HTTP {response.status_code}")
        return response

    def branch_path(self, name):
        return self.root + "/local/branch/" + name

    def write(self, branch, documents, *, replace=False, schema=False):
        result = self.request(
            "PUT" if replace else "POST",
            "document/" + self.branch_path(branch),
            params={
                "graph_type": "schema" if schema else "instance",
                "author": "synthetic-spike",
                "message": "Synthetic knowledge lifecycle experiment",
            },
            json=documents,
        )
        version = result.headers.get("terminusdb-data-version", "")
        if not version.startswith("branch:"):
            raise SpikeFailure("Engine did not return an immutable branch data version")
        return version

    def documents(self, path):
        return self.request(
            "GET", "document/" + path, params={"as_list": "true", "compress_ids": "true"}
        ).json()

    def branch(self, name, origin):
        self.request("POST", "branch/" + self.branch_path(name), json={"origin": origin})

    def apply(self, target, before, after, *, conflict=False):
        result = self.request(
            "POST",
            "apply/" + self.branch_path(target),
            expected=(409,) if conflict else (200,),
            json={
                "before_commit": before,
                "after_commit": after,
                "commit_info": {"author": "synthetic-spike", "message": "Synthetic merge test"},
                "type": "squash",
                "match_final_state": True,
            },
        )
        if conflict and not result.json().get("api:witnesses"):
            raise SpikeFailure("Conflict response omitted witnesses")

    def run(self):
        info = self.request("GET", "info").json()
        # A colliding database fails creation; never adopt or delete an existing database.
        self.request(
            "POST",
            "db/" + self.root,
            json={
                "label": "Synthetic CortexFusion spike",
                "comment": "Disposable engine evaluation",
                "schema": True,
                "public": False,
            },
        )
        self.write("main", SCHEMA, schema=True)
        seed = [
            {"@id": "Concept/X", "@type": "Concept", "label": "Synthetic capability X"},
            {"@id": "Concept/Y", "@type": "Concept", "label": "Synthetic use case Y"},
            {"@id": "Evidence/E1", "@type": "Evidence", "locator": "fixture://synthetic-evidence"},
            {"@id": "Owner/O1", "@type": "Owner", "label": "Synthetic owner"},
        ]
        base = self.write("main", seed)
        baseline = self.documents(self.branch_path("main"))
        self.branch("proposal", self.branch_path("main"))
        atom = {
            "@id": "KnowledgeAtom/A1",
            "@type": "KnowledgeAtom",
            "subject": "Concept/X",
            "predicate": "SUPPORTS",
            "object": "Concept/Y",
            "context": "synthetic",
            "evidence": "Evidence/E1",
            "owner": "Owner/O1",
            "business_version": 1,
        }
        proposed = self.write("proposal", [atom])
        if self.documents(self.branch_path("main")) != baseline:
            raise SpikeFailure("A draft branch changed main")
        delta = self.request(
            "POST",
            "diff/" + self.root,
            json={"before_data_version": base, "after_data_version": proposed},
        ).json()
        if not delta:
            raise SpikeFailure("Missing structural diff")
        # Immutable base is retained, never replace it with the current target branch head.
        self.apply("main", base, proposed)
        main = self.documents(self.branch_path("main"))
        atoms = [d for d in main if d.get("@type") == "KnowledgeAtom"]
        if len(atoms) != 1 or atoms[0]["predicate"] != "SUPPORTS":
            raise SpikeFailure("Merged assertion not visible")
        historical = self.documents(self.root + "/local/commit/" + base.split(":", 1)[1])
        if historical != baseline:
            raise SpikeFailure("Historical snapshot changed")
        self.branch("left", self.branch_path("main"))
        self.branch("right", self.branch_path("main"))
        # Obtain the true common base from a branch read, before either edit.
        common = self.request(
            "GET", "document/" + self.branch_path("main"), params={"as_list": "true"}
        ).headers["terminusdb-data-version"]
        self.write("left", [{**atom, "context": "left", "business_version": 2}], replace=True)
        right = self.write(
            "right", [{**atom, "context": "right", "business_version": 2}], replace=True
        )
        left_before = self.documents(self.branch_path("left"))
        self.apply("left", common, right, conflict=True)
        if self.documents(self.branch_path("left")) != left_before:
            raise SpikeFailure("Conflicting apply partially changed its target")
        # Diverge main and a fresh proposal with disjoint changes. Applying a diff
        # from the current main instead of the true base could erase main's edit.
        self.branch("independent", self.branch_path("main"))
        divergence_base = self.request(
            "GET", "document/" + self.branch_path("main"), params={"as_list": "true"}
        ).headers["terminusdb-data-version"]
        self.write("main", [{**seed[0], "label": "Changed independently on main"}], replace=True)
        revised_atom = {**atom, "context": "revised", "business_version": 2}
        independent = self.write("independent", [revised_atom], replace=True)
        self.apply("main", divergence_base, independent)
        merged = self.documents(self.branch_path("main"))
        if not any(d.get("label") == "Changed independently on main" for d in merged):
            raise SpikeFailure("Merge lost an independent main edit")
        merged_atoms = [d for d in merged if d.get("@type") == "KnowledgeAtom"]
        if len(merged_atoms) != 1 or merged_atoms[0]["context"] != "revised":
            raise SpikeFailure("Independent proposal edit was lost")
        before_compensation = self.request(
            "GET", "document/" + self.branch_path("main"), params={"as_list": "true"}
        ).headers["terminusdb-data-version"]
        # Compensate the assertion's context with a new business revision. Do not
        # reset the branch or roll back the independent concept edit.
        after_compensation = self.write("main", [{**atom, "business_version": 3}], replace=True)
        if after_compensation == before_compensation:
            raise SpikeFailure("Compensation did not create a new engine version")
        compensated = self.documents(self.branch_path("main"))
        current_atom = next(d for d in compensated if d.get("@type") == "KnowledgeAtom")
        if current_atom["business_version"] != 3 or current_atom["context"] != "synthetic":
            raise SpikeFailure("Compensation did not restore the intended assertion context")
        if not any(d.get("label") == "Changed independently on main" for d in compensated):
            raise SpikeFailure("Compensation erased an unrelated concept change")
        prior = self.documents(self.root + "/local/commit/" + before_compensation.split(":", 1)[1])
        prior_atom = next(d for d in prior if d.get("@type") == "KnowledgeAtom")
        if prior_atom["business_version"] != 2 or prior_atom["context"] != "revised":
            raise SpikeFailure("Compensation erased the previous business revision")
        conflicts = semantic_conflicts([atom, {**atom, "predicate": "INCOMPATIBLE_WITH"}])
        if len(conflicts) != 1:
            raise SpikeFailure("Synthetic semantic rule failed")
        return {
            "status": "passed",
            "server_info": info,
            "source_reference": SOURCE_COMMIT,
            "database": self.database,
            "checks": [
                "typed_atoms_and_evidence",
                "isolated_proposal_branch",
                "structural_diff",
                "apply_from_immutable_base",
                "historical_read",
                "field_conflict_atomicity",
                "divergent_disjoint_changes_preserved",
                "additive_compensation_preserves_history_and_unrelated_edits",
                "deterministic_semantic_rule",
            ],
            "not_validated": [
                "product_authorization",
                "approval_workflow",
                "multi_store_atomicity",
                "HA",
                "backup",
                "scale",
                "GraphRAG",
                "monetary_or_quality_claims",
            ],
            "model_calls": 0,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:6363")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    password = os.environ.get("CORTEX_SPIKE_TERMINUS_PASSWORD")
    if not password:
        parser.error("Set CORTEX_SPIKE_TERMINUS_PASSWORD for a disposable local engine")
    probe = TerminusProbe(args.url, password)
    try:
        report = probe.run()
    except (SpikeFailure, KeyError, ValueError) as exc:
        report = {
            "status": "failed",
            "stage": "engine_probe",
            "error_type": type(exc).__name__,
            "database": probe.database,
            "model_calls": 0,
        }
        args.output.write_text(json.dumps(report, indent=2) + "\n")
        raise SystemExit(
            "TerminusDB probe failed; inspect isolated engine, do not retry existing mutations"
        ) from None
    finally:
        probe.close()
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print("Synthetic TerminusDB probe passed; report saved")


if __name__ == "__main__":
    main()
