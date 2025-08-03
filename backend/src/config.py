from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional


class Settings(BaseSettings):
    database_url: str = "file:../pharma_search.db"  # Default to DuckDB
    database_path: Optional[str] = None  # Will be derived from database_url
    batch_size: int = 10000
    similarity_threshold: float = 0.85
    api_port: int = 8000
    model_config = SettingsConfigDict(env_file=".env")
    
    def get_database_path(self) -> str:
        """Extract database path from DATABASE_URL"""
        import os
        
        if self.database_path:
            path = self.database_path
        elif self.database_url.startswith("file:"):
            path = self.database_url[5:]  # Remove 'file:' prefix
        else:
            path = "pharma_search.db"
        
        # Expand home directory if needed
        if path.startswith("~/"):
            path = os.path.expanduser(path)
        
        return path


settings = Settings()
