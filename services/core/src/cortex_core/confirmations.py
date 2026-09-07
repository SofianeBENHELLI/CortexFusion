"""Single-use confirmations signed by a trusted host, never by model arguments."""

import time
from uuid import UUID

import jwt
from sqlalchemy.exc import IntegrityError

from .auth import CoreError
from .service import digest, run


def command_hash(action, arguments):
    return digest({"action": action, "arguments": arguments})


class ConfirmationVerifier:
    def __init__(self, public_key_file, db):
        self.public_key = public_key_file.read_text() if public_key_file else None
        self.db = db

    def consume(self, p, domain, action, arguments, token):
        if not self.public_key or not token:
            raise CoreError(
                "CONFIRMATION_REQUIRED",
                "A trusted-host confirmation is required for this exact action",
                428,
            )
        try:
            claims = jwt.decode(
                token,
                self.public_key,
                algorithms=["RS256"],
                audience="cortex-mcp-confirmation",
                issuer="cortex-trusted-host",
                options={
                    "require": [
                        "sub",
                        "tenant",
                        "action",
                        "command_hash",
                        "jti",
                        "iat",
                        "exp",
                        "iss",
                        "aud",
                    ]
                },
            )
            UUID(claims["jti"])
            if (
                claims["sub"] != p.subject
                or claims["tenant"] != p.tenant_id
                or claims["action"] != action
                or claims["command_hash"] != command_hash(action, arguments)
                or type(claims["iat"]) is not int
                or type(claims["exp"]) is not int
                or not 0 < claims["exp"] - claims["iat"] <= 300
                or claims["iat"] > time.time()
            ):
                raise ValueError("mismatch")
        except (jwt.PyJWTError, ValueError, TypeError, KeyError):
            raise CoreError(
                "CONFIRMATION_INVALID",
                "Confirmation is invalid, expired or does not match this action",
                403,
            ) from None
        try:
            with self.db.transaction(p, domain, owner=True) as conn:
                run(
                    conn,
                    "INSERT INTO cf_mcp_confirmations(tenant_id,domain_id,id,subject,action,command_hash) VALUES(:tenant,:domain,:id,:subject,:action,:hash)",
                    tenant=p.tenant_id,
                    domain=domain,
                    id=claims["jti"],
                    subject=p.subject,
                    action=action,
                    hash=claims["command_hash"],
                )
        except IntegrityError:
            raise CoreError(
                "CONFIRMATION_USED",
                "Confirmation already consumed; inspect state before preparing a new decision",
                409,
            ) from None


def sign_confirmed_action(private_key, subject, tenant, action, arguments, ttl=120):
    """Trusted-host helper: call only after displaying and confirming this exact command.

    Keep the signing key outside both the model and the backend execution host.
    The return value belongs in the transport header, never in an LLM prompt.
    """
    from uuid import uuid4

    if type(ttl) is not int or not 0 < ttl <= 300:
        raise ValueError("Confirmation lifetime must be 1..300 seconds")
    now = int(time.time())
    return jwt.encode(
        {
            "iss": "cortex-trusted-host",
            "aud": "cortex-mcp-confirmation",
            "sub": subject,
            "tenant": tenant,
            "action": action,
            "command_hash": command_hash(action, arguments),
            "jti": str(uuid4()),
            "iat": now,
            "exp": now + ttl,
        },
        private_key,
        algorithm="RS256",
    )
