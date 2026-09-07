# Local restore rehearsal

On 2026-09-07, a PostgreSQL 17.11 custom-format backup of the development `_test` database was restored into a new isolated `_test` database in the same local cluster. The original database was preserved. No archive or enterprise document was published.

All **29 tables** (application tables plus Alembic version) matched by row count and deterministic row-content checksum before any new writes to the restored database. Row-security enablement, forced RLS and policy expressions also matched. The restored application role passed the backend's non-superuser/non-BYPASSRLS/non-owner checks. The synthetic HTTP demonstration then passed against the restored database: agent approval denied, owner approval/publication, cited answer, replay and compensation to version 2. No external model was called.

This is evidence for one logical restore on the same PostgreSQL version and cluster with the restricted application role already provisioned. It does not validate offsite storage, backup encryption/key recovery, a fresh host, point-in-time recovery, production RPO/RTO or enterprise-scale restore performance. The archive includes private application history and files; treat actual deployment backups with the same access restrictions as the database.

## Repeat the rehearsal

Use a dedicated development source ending in `_test`, and a new target name also ending in `_test`. Stop writes while comparing logical snapshots, or design a consistent snapshot comparison for an actively changing database. Configure PostgreSQL's connection environment for the intended local instance and a migration/backup administrator; do not paste credentials into command arguments or committed files.

```sh
# Set PGHOST, PGPORT and PGUSER for the intended instance.
# Supply authentication through your normal protected PostgreSQL mechanism.
cortex_source_db=cortex_test
cortex_restore_db=cortex_restore_rehearsal_test
cortex_archive=artifacts/cortex-rehearsal.dump
umask 077
mkdir -p artifacts
pg_dump --format=custom --file="$cortex_archive" "$cortex_source_db"
createdb "$cortex_restore_db"
pg_restore --no-owner --exit-on-error --dbname="$cortex_restore_db" "$cortex_archive"
```

`createdb` should fail if the target already exists. Choose a new target; do not overwrite the source or use `--clean` to force this rehearsal. Retain archive ACLs rather than stripping them. On a different cluster, provision the intended restricted application role and migration ownership policy before restore.

Compare application table inventories/counts/content checksums and RLS policies before introducing new test writes. Then point `CORTEX_TEST_ADMIN_URL` and `CORTEX_TEST_DATABASE_URL` to the restored target, using the administrator and restricted application roles respectively, and run:

```sh
uv run python scripts/demo_core.py
```

For an independent broader check after a materially different restore/environment, use `make test`. These fixtures add synthetic tenants/data and require database names ending in `_test`. Keep recovery archives private and decide retention separately; this repository does not implement an automated backup service or delete the rehearsal database for you.
