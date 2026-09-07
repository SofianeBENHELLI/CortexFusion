UV ?= uv
PNPM ?= pnpm

.PHONY: setup dev-up migrate lint contracts test-core test-node test licenses demo-core serve
setup:
	$(UV) sync --locked
	$(PNPM) install --frozen-lockfile

dev-up:
	docker compose --env-file .env -f infra/compose.yaml up -d

migrate:
	$(UV) run alembic upgrade head

lint:
	$(UV) run ruff check .
	$(UV) run ruff format --check .
	$(PNPM) typecheck

contracts:
	$(UV) run python scripts/export_interactions.py --check
	$(UV) run python scripts/export_contracts.py --check
	$(UV) run python scripts/export_frontend_reference.py --check
	$(PNPM) contracts:check

test-core:
	$(UV) run pytest -q

test-node:
	$(PNPM) build
	$(PNPM) test

licenses:
	$(UV) run python scripts/check_licenses.py

test: lint contracts test-core test-node licenses

demo-core:
	$(UV) run python scripts/demo_core.py

serve:
	$(UV) run cortex serve
