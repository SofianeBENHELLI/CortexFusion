from pathlib import Path
from urllib.parse import urlparse

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CORTEX_", extra="ignore")
    database_url: str
    jwt_issuer: str
    jwt_audience: str = "cortex-core"
    jwt_public_key_file: Path | None = None
    jwks_url: str | None = None
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
