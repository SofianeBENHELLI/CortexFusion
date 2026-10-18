"""Only reviewed opaque app navigation survives an authorization round trip."""

import json
import re
from datetime import datetime
from urllib.parse import parse_qsl, urlencode, urlsplit
from uuid import UUID

from .oidc import LoginError


def _uuid(value):
    return (
        isinstance(value, str)
        and bool(re.fullmatch(r"[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}", value))
        and str(UUID(value)) == value.lower()
    )


def safe_return_route(value: str = "/") -> str:
    if (
        not isinstance(value, str)
        or len(value) > 2048
        or any(ord(c) < 33 or ord(c) > 126 for c in value)
        or "\\" in value
        or re.search(r"%(?![0-9a-fA-F]{2})", value)
    ):
        raise LoginError("RETURN_ROUTE_REJECTED")
    try:
        parsed = urlsplit(value)
        if parsed.scheme or parsed.netloc or parsed.path != "/" or parsed.fragment:
            raise ValueError
        pairs = parse_qsl(parsed.query, keep_blank_values=True, max_num_fields=20, errors="strict")
        params = dict(pairs)
        if len(params) != len(pairs):
            raise ValueError
        for name, item in pairs:
            if name in {
                "api_domain",
                "api_conversation",
                "api_import",
                "api_proposal",
                "api_task",
                "api_case",
                "map_node",
            }:
                valid = _uuid(item)
            elif name == "api_dossier":
                valid = item in {"cases", "tasks", "sources", "issues", "proposals", "imports", "references", "referenceReviews", "missions"}
            elif name == "api_view":
                valid = item in {"brain", "work", "overview"}
            elif name in {"colors", "map_changes"}:
                valid = item == "1"
            elif name == "mode":
                valid = item in {"overview", "changes"}
            elif name == "map_transport":
                valid = item == "viewport"
            elif name == "history_pages":
                valid = item in {"1", "5"}
            elif name == "domains_page":
                valid = bool(re.fullmatch(r"[1-9][0-9]{0,3}", item))
            elif name in {"time_from", "time_to"}:
                valid = bool(re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z", item))
                if valid:
                    datetime.fromisoformat(item)
            elif name == "map_event":
                # Journal identity: domain, sequence, concept, change kind, optional relation id.
                event = json.loads(item)
                valid = (
                    isinstance(event, list)
                    and len(event) == 5
                    and _uuid(event[0])
                    and type(event[1]) is int
                    and 0 <= event[1] <= 9007199254740991
                    and _uuid(event[2])
                    and isinstance(event[3], str)
                    and event[0] == params.get("api_domain")
                )
                if valid and event[3] in {"concept_created", "concept_updated", "concept_removed"}:
                    valid = event[4] == ""
                elif (
                    valid
                    and event[3]
                    in {
                        "relation_created",
                        "relation_removed",
                        "relation_strengthened",
                        "relation_weakened",
                        "relation_primary_changed",
                    }
                    and isinstance(event[4], str)
                ):
                    relation = json.loads(event[4])
                    valid = (
                        isinstance(relation, list)
                        and len(relation) == 4
                        and relation[0] == event[0]
                        and relation[1] == event[2]
                        and _uuid(relation[2])
                        and isinstance(relation[3], str)
                        and relation[3] in {"structural", "associative"}
                    )
                else:
                    valid = False
            else:
                valid = False
            if not valid:
                raise ValueError
        if (
            any(
                k in params
                for k in (
                    "api_conversation",
                    "api_import",
                    "api_proposal",
                    "api_task",
                    "api_case",
                    "map_node",
                    "map_event",
                )
            )
            and "api_domain" not in params
        ):
            raise ValueError
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise LoginError("RETURN_ROUTE_REJECTED") from None
    return "/" + ("?" + urlencode(pairs) if pairs else "")
