from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from environment variables (or a local .env file)."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "SaaSquatch Pro API"
    environment: str = "development"

    # postgresql+psycopg://user:password@host:5432/dbname
    database_url: str = "postgresql+psycopg://caprae:caprae@localhost:5432/caprae"
    db_pool_size: int = 5
    db_max_overflow: int = 10

    # Comma-separated list of allowed browser origins, e.g. "https://app.example.com,http://localhost:3000"
    cors_origins: str = "http://localhost:3000"

    # Claude (AI Outreach Copilot). When unset the copilot falls back to deterministic templates.
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-5-5"

    # Enrichment crawler
    crawler_user_agent: str = "SaaSquatchProBot/1.0 (+https://www.saasquatchleads.com; lead-enrichment)"
    crawler_timeout_seconds: float = 8.0
    crawler_max_pages: int = 4
    crawler_concurrency: int = 5
    enrichment_cache_days: int = 7
    respect_robots_txt: bool = True
    # Optional egress proxy (e.g. a rotating residential proxy) for sites that rate-limit by IP.
    crawler_proxy_url: str | None = None

    seed_sample_data: bool = True

    @field_validator("database_url")
    @classmethod
    def normalize_db_url(cls, v: str) -> str:
        # Managed providers (RDS secrets, Heroku-style URLs) often hand out postgres:// URLs.
        if v.startswith("postgres://"):
            v = "postgresql+psycopg://" + v[len("postgres://"):]
        elif v.startswith("postgresql://"):
            v = "postgresql+psycopg://" + v[len("postgresql://"):]
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    @property
    def ai_enabled(self) -> bool:
        return bool(self.anthropic_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
