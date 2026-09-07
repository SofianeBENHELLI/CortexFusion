from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import AliasChoices, Field, HttpUrl, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CORTEX_", extra="ignore")
    database_url: str
    jwt_issuer: str
    jwt_audience: str = "cortex-core"
    jwt_public_key_file: Path | None = None
    jwks_url: str | None = None
    model_provider: Literal["openrouter", "ollama"] = "openrouter"
    openrouter_model: str | None = None
    openrouter_api_key: SecretStr | None = Field(
        default=None,
        exclude=True,
        validation_alias=AliasChoices(
            "CORTEX_OPENROUTER_API_KEY", "OPENROUTER_API_KEY", "openrouter_api_key"
        ),
    )
    confirmation_public_key_file: Path | None = None
    http_confirmation_mode: Literal["required", "trusted_host"] = "required"
    cors_origins: list[str] = Field(default_factory=list, max_length=20)
    mcp_public_url: str | None = None
    synthesis_enabled: bool = False
    model_daily_attempt_limit: int = Field(default=100, ge=1, le=100000)
    local_model: str | None = None
    ollama_url: str = "http://127.0.0.1:11434"
    max_request_bytes: int = Field(default=1000000, ge=1000)

    @model_validator(mode="after")
    def validate_security(self):
        if len(self.cors_origins) != len(set(self.cors_origins)):
            raise ValueError("CORS origins must be unique")
        for origin in self.cors_origins:
            parsed = HttpUrl(origin)
            if (
                any(c.isspace() for c in origin)
                or "*" in origin
                or parsed.username
                or parsed.password
                or parsed.query
                or parsed.fragment
                or parsed.path != "/"
                or str(parsed).removesuffix("/") != origin
                or (
                    parsed.scheme != "https"
                    and parsed.host not in {"localhost", "127.0.0.1", "[::1]"}
                )
            ):
                raise ValueError(
                    "CORS origins require canonical HTTPS or explicit HTTP loopback, without a path"
                )
        if not self.database_url.startswith("postgresql+pg8000://"):
            raise ValueError("Cortex requires PostgreSQL through pg8000")
        if bool(self.jwt_public_key_file) == bool(self.jwks_url):
            raise ValueError("configure exactly one public key file or HTTPS JWKS URL")
        if self.jwks_url and urlparse(self.jwks_url).scheme != "https":
            raise ValueError("JWKS must use HTTPS")
        if self.mcp_public_url:
            resource, issuer = HttpUrl(self.mcp_public_url), HttpUrl(self.jwt_issuer)
            if (
                resource.scheme != "https"
                or resource.path != "/mcp/"
                or resource.username
                or resource.password
                or resource.query
                or resource.fragment
                or str(resource) != self.mcp_public_url
            ):
                raise ValueError("MCP public URL must be canonical HTTPS ending in /mcp/")
            if (
                issuer.scheme != "https"
                or issuer.username
                or issuer.password
                or issuer.query
                or issuer.fragment
                or any(c.isspace() or c == '"' for c in self.jwt_issuer)
            ):
                raise ValueError("MCP authorization issuer must be a clean HTTPS URL")
            if self.jwt_audience != self.mcp_public_url:
                raise ValueError("JWT audience must equal the MCP public resource URL")
        return self
