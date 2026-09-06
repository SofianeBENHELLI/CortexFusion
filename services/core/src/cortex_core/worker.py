"""Trusted-host file worker. Database credentials and its scoped identity stay server-side."""

import os
import time

from .auth import CoreError, Principal
from .corpus import CorpusService
from .db import Database
from .files import FileService
from .service import KnowledgeService


def drain(service, principal, domain, max_jobs):
    page = service.listing(principal, domain, max_jobs, None, True)
    completed = 0
    for item in page["items"]:
        try:
            service.process(principal, domain, item["id"])
            completed += 1
        except CoreError as exc:
            if exc.code not in ("FILE_BUSY", "STALE_LEASE", "FILE_CANCELLED", "NOT_FOUND"):
                raise
    return completed


def run_worker(tenant, domain, subject, once, max_jobs, poll_seconds):
    db = Database(os.environ["CORTEX_DATABASE_URL"])
    db.verify_role()
    service = FileService(CorpusService(KnowledgeService(db)))
    principal = Principal(subject, tenant)
    try:
        while True:
            count = drain(service, principal, domain, max_jobs)
            print(f"File worker completed {count} attempt(s).", flush=True)
            if once:
                return
            time.sleep(poll_seconds)
    finally:
        db.dispose()
