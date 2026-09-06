from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import AliasChoices, Field, SecretStr, model_validator
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
    local_model: str | None = None
    ollama_url: str = "http://127.0.0.1:11434"
    max_request_bytes: int = Field(default=1000000, ge=1000)

    @model_validator(mode="after")
    def validate_security(self):
        if not self.database_url.startswith("postgresql+pg8000://"):
            raise ValueError("Cortex requires PostgreSQL through pg8000")
        if bool(self.jwt_public_key_file) == bool(self.jwks_url):
            raise ValueError("configure exactly one public key file or HTTPS JWKS URL")
        if self.jwks_url and urlparse(self.jwks_url).scheme != "https":
            raise ValueError("JWKS must use HTTPS")
        return self
