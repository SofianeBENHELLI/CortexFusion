import pytest

from scripts.check_licenses import RUST_TERMS, spdx_allows


@pytest.mark.parametrize(
    "expression,allowed",
    [
        ("MIT OR Apache-2.0", True),
        ("Apache-2.0/MIT", True),
        ("(MIT OR Apache-2.0) AND Unicode-3.0", True),
        ("Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT", True),
        ("MIT OR Apache-2.0 OR LGPL-2.1-or-later", True),
        ("LGPL-2.1-or-later", False),
        ("GPL-3.0 AND MIT", False),
        ("(MIT OR GPL-3.0) AND GPL-2.0", False),
        ("Apache-2.0 WITH LLVM-exception", False),
        ("UNKNOWN", False),
        ("(MIT", False),
        ("MIT OR", False),
        ("", False),
    ],
)
def test_rust_license_expressions_need_one_fully_allowed_branch(expression, allowed):
    assert spdx_allows(expression, RUST_TERMS) is allowed
