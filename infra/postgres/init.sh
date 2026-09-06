#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 <<'SQL'
\getenv app_password CORTEX_APP_PASSWORD
CREATE ROLE cortex_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'app_password';
SQL
