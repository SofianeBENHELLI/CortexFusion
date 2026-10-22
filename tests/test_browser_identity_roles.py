from copy import deepcopy

import pytest
from cortex_browser_gateway.identity import public_identity
from cortex_browser_gateway.oidc import IdentityGrant, LoginError

T = "00000000-0000-0000-0000-000000000001"
D = "00000000-0000-0000-0000-000000000002"


def test_public_roles_and_revision_are_validated_without_credentials():
    grant = IdentityGrant("synthetic", T, 9999999999, "private")
    source = dict(
        subject="synthetic",
        tenant_id=T,
        domains=[
            dict(
                id=D,
                name="Synthetic",
                role="contributor",
                roles=["viewer", "contributor"],
                membership_revision=2,
                capabilities=["query"],
                secret="never exposed",
            )
        ],
    )
    result = public_identity(source, grant)
    assert result["domains"][0]["roles"] == ["viewer", "contributor"]
    assert result["domains"][0]["membership_revision"] == 2
    assert "secret" not in result["domains"][0]
    for patch in [
        dict(roles=[]),
        dict(roles=["owner"]),
        dict(roles=["agent", "contributor"]),
        dict(roles=["viewer", "viewer"]),
        dict(roles=[{}]),
        dict(membership_revision=True),
        dict(membership_revision=-1),
    ]:
        bad = deepcopy(source)
        bad["domains"][0].update(patch)
        with pytest.raises(LoginError):
            public_identity(bad, grant)
