# Local infrastructure

`compose.yaml` supplies PostgreSQL 17.11 for the development/test core, bound to loopback. `postgres/init.sh` provisions a separate non-superuser application role using configured credentials. Do not use migration credentials in the API.

This profile intentionally omits AGE/vector, Temporal, identity hosting, and production deployment. AGE/vector compatibility was checked separately; no graph/vector adapter is active in the application yet. Follow the [development guide](../docs/development.md).
