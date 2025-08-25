from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional


class Settings(BaseSettings):
    database_url: str
    batch_size: int = 10000
    similarity_threshold: float = 0.85
    api_port: int = 8000
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="allow",  # allow unspecified env vars (e.g., SMTP_*)
    )


settings = Settings()
