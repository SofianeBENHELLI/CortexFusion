"""Cumulative human responsibilities retain native permission semantics."""

from itertools import combinations
from uuid import uuid4

import pytest
from cortex_core.contracts import MembershipInput
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

ORDER = ["owner", "corpus_manager", "contributor", "viewer"]


def test_all_human_combinations_and_legacy_replacement(world):
    base = dict(
        subject="roles-fixture",
        reason="Synthetic cumulative role decision",
        idempotency_key=str(uuid4()),
        role="viewer",
    )
    previous = None
    for size in range(1, 5):
        for roles in combinations(ORDER, size):
            data = {
                **base,
                "role": roles[0],
                "roles": list(reversed(roles)),
                "expected_revision": previous,
                "idempotency_key": str(uuid4()),
            }
            r = world.client.post(world.prefix + "/members", json=data, headers=world.headers())
            assert r.status_code == 201, r.text
            receipt = r.json()
            previous = receipt["resulting_revision"]
            assert receipt["new_roles"] == list(roles)
            assert (
                world.client.post(
                    world.prefix + "/members", json=data, headers=world.headers()
                ).json()
                == receipt
            )
            d = world.client.get("/v1/me", headers=world.headers("roles-fixture")).json()[
                "domains"
            ][0]
            assert (
                d["roles"] == list(roles)
                and d["role"] == roles[0]
                and d["membership_revision"] == previous
            )
    legacy = {**base, "expected_revision": previous, "idempotency_key": str(uuid4())}
    r = world.client.post(world.prefix + "/members", json=legacy, headers=world.headers())
    assert r.status_code == 201 and r.json()["new_roles"] == ["viewer"]
    assert (
        world.client.get(
            world.prefix + "/members", headers=world.headers("roles-fixture")
        ).status_code
        == 403
    )
    assert (
        world.client.get(
            f"/v1/domains/{world.other_domain}/members", headers=world.headers("roles-fixture")
        ).status_code
        == 404
    )


@pytest.mark.parametrize(
    "role,roles",
    [
        ("viewer", []),
        ("viewer", ["viewer", "viewer"]),
        ("owner", ["viewer"]),
        ("agent", ["agent", "owner"]),
        ("viewer", ["alien"]),
        (None, ["viewer"]),
    ],
)
def test_invalid_sets_rejected_before_decision(role, roles):
    with pytest.raises(ValidationError):
        MembershipInput(
            subject="synthetic",
            role=role,
            roles=roles,
            reason="Synthetic",
            idempotency_key=str(uuid4()),
        )


def test_storage_projection_and_invalid_arrays(world):
    with world.admin.begin() as conn:
        conn.execute(
            text(
                "UPDATE cf_memberships SET roles=ARRAY['viewer','contributor'] WHERE tenant_id=:t AND domain_id=:d AND subject='agent'"
            ),
            dict(t=world.tenant, d=world.domain),
        )
    d = world.client.get("/v1/me", headers=world.headers("agent")).json()["domains"][0]
    assert d["role"] == "contributor" and d["roles"] == ["contributor", "viewer"]
    for roles in [[], ["owner", "owner"], ["agent", "viewer"], ["unknown"], [None]]:
        with pytest.raises(DBAPIError), world.admin.begin() as conn:
            conn.execute(
                text(
                    "UPDATE cf_memberships SET roles=:r WHERE tenant_id=:t AND domain_id=:d AND subject='agent'"
                ),
                dict(t=world.tenant, d=world.domain, r=roles),
            )


def test_last_owner_cannot_be_hidden_by_an_extra_role(world):
    data = dict(
        subject="alice",
        role="contributor",
        roles=["contributor", "viewer"],
        expected_revision=0,
        reason="Synthetic last-owner guard",
        idempotency_key=str(uuid4()),
    )
    r = world.client.post(world.prefix + "/members", json=data, headers=world.headers())
    assert r.status_code == 409 and r.json()["error"] == "LAST_OWNER"
    current = world.client.get("/v1/me", headers=world.headers()).json()["domains"][0]
    assert current["roles"] == ["owner"] and current["membership_revision"] == 0
