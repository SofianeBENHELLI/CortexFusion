"""An expired caller must not receive a version after waiting for the SQL pool."""

import time
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import text


def verify_expiry(client, headers, domain, tenant, admin, application_name):
    blocker = admin.connect()
    transaction = blocker.begin()
    try:
        blocker.execute(
            text("SELECT id FROM cf_domains WHERE tenant_id=:t AND id=:d FOR UPDATE"),
            {"t": tenant, "d": domain},
        )
        with ThreadPoolExecutor(max_workers=11) as pool:
            readers = [
                pool.submit(
                    client.get,
                    f"/v1/domains/{domain}/model-usage",
                    headers=headers(),
                )
                for _ in range(10)
            ]
            try:
                deadline = time.monotonic() + 2
                blocked = 0
                while time.monotonic() < deadline:
                    with admin.connect() as connection:
                        blocked = connection.execute(
                            text(
                                "SELECT count(*) FROM pg_stat_activity "
                                "WHERE application_name=:name AND wait_event_type='Lock' "
                                "AND state='active'"
                            ),
                            {"name": application_name},
                        ).scalar_one()
                    if blocked == 10:
                        break
                    time.sleep(0.01)
                assert blocked == 10, blocked
                # Preserve the integer NumericDate semantics shared with the reference.
                expires = int(time.time()) + 2
                response = pool.submit(
                    client.get,
                    f"/v1/domains/{domain}/version",
                    headers=headers(exp=expires),
                )
                time.sleep(0.05)
                assert not response.done(), "Version did not wait behind the saturated pool"
                time.sleep(max(0, expires - time.time()) + 0.1)
            finally:
                transaction.commit()
            result = response.result()
            assert result.status_code == 401, (result.status_code, result.text)
            assert all(reader.result().status_code == 200 for reader in readers)
    finally:
        if transaction.is_active:
            transaction.rollback()
        blocker.close()
    return ["expired_identity_rejected_after_ten_connection_pool_wait"]
