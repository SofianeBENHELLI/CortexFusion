import json
from pathlib import Path

import pytest
from cortex_core.contracts import CONTRACTS, ApprovalInput, Link, SourceRef
from jsonschema import Draft202012Validator, FormatChecker
from pydantic import ValidationError


@pytest.mark.parametrize("contract", CONTRACTS)
def test_committed_schema_matches_runtime(contract):
    expected = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        **contract.model_json_schema(),
    }
    actual = json.loads(
        (Path("packages/contracts/schema") / f"{contract.__name__}.json").read_text()
    )
    assert actual == expected
    Draft202012Validator.check_schema(actual)


def test_contract_semantic_validators():
    with pytest.raises(ValidationError):
        SourceRef(source_id="00000000-0000-4000-8000-000000000001", start=4, end=2)
    with pytest.raises(ValidationError):
        Link(target_id="00000000-0000-4000-8000-000000000001", kind="associative", primary=True)
    with pytest.raises(ValidationError):
        ApprovalInput(
            digest="a" * 64,
            expected_version=0,
            reason="example",
            idempotency_key="example-1",
            role="owner",
        )


def test_shared_wire_examples():
    for path in Path("packages/contracts/examples").glob("*.json"):
        example = json.loads(path.read_text())
        schema = json.loads(
            (Path("packages/contracts/schema") / f"{example['contract']}.json").read_text()
        )
        valid = Draft202012Validator(schema, format_checker=FormatChecker()).is_valid(
            example["value"]
        )
        assert valid == example["valid"], path.name
