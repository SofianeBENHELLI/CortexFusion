# Wire contracts

The maintained source is `services/core/src/cortex_core/contracts.py`. `scripts/export_contracts.py` exports JSON Schema into `schema/`; `scripts/generate-types.mjs` produces TypeScript declarations in `src/`. CI rejects drift between these artifacts.

Python and Node validate the same synthetic examples in `examples/`. Structural wire validation is separate from application authorization and semantic invariants such as source support, graph acyclicity and proposal/decision binding.

After changing a contract, run both generators and the contract checks. Do not manually edit generated TypeScript or assume its compile-time types validate untrusted runtime data.
