"""
DuckDB database connection and configuration
"""
import duckdb
import asyncio
import os
from typing import Optional, List, Dict, Any
import logging
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)


class DuckDBConnection:
    """
    DuckDB connection manager with async support
    """
    
    def __init__(self, db_path: str = ":memory:", config: Optional[Dict[str, Any]] = None):
        self.db_path = db_path
        self.config = config or {}
        self._conn: Optional[duckdb.DuckDBPyConnection] = None
        self._lock = asyncio.Lock()
        
    async def connect(self):
        """Initialize DuckDB connection"""
        if self._conn is None:
            # Create database directory if file-based
            if self.db_path != ":memory:" and "/" in self.db_path:
                os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
            
            self._conn = duckdb.connect(self.db_path, config=self.config)
            
            # Install and load full-text search extension
            await self._setup_fts()
            
            logger.info(f"Connected to DuckDB at {self.db_path}")
    
    async def _setup_fts(self):
        """Install and configure full-text search extension"""
        async with self._lock:
            # Install FTS extension
            self._conn.execute("INSTALL fts")
            self._conn.execute("LOAD fts")
            
            # Create FTS configuration if not exists
            try:
                self._conn.execute("""
                    PRAGMA create_fts_index(
                        'products_fts', 
                        'Product', 
                        'title', 'normalizedName', 'description'
                    )
                """)
            except Exception as e:
                # Index might already exist
                logger.debug(f"FTS index creation skipped: {e}")
    
    async def disconnect(self):
        """Close DuckDB connection"""
        if self._conn:
            self._conn.close()
            self._conn = None
            logger.info("Disconnected from DuckDB")
    
    @asynccontextmanager
    async def get_connection(self):
        """Get DuckDB connection with lock"""
        async with self._lock:
            if self._conn is None:
                await self.connect()
            yield self._conn
    
    async def execute(self, query: str, params: Optional[List] = None) -> List[Dict]:
        """Execute query and return results as list of dicts"""
        async with self.get_connection() as conn:
            try:
                if params:
                    result = conn.execute(query, params).fetchall()
                else:
                    result = conn.execute(query).fetchall()
                
                # Get column names
                columns = [desc[0] for desc in conn.description]
                
                # Convert to list of dicts
                return [dict(zip(columns, row)) for row in result]
            except Exception as e:
                logger.error(f"Query execution failed: {e}")
                logger.error(f"Query: {query}")
                logger.error(f"Params: {params}")
                raise
    
    async def execute_many(self, query: str, params_list: List[List]) -> None:
        """Execute query with multiple parameter sets"""
        async with self.get_connection() as conn:
            try:
                conn.executemany(query, params_list)
            except Exception as e:
                logger.error(f"Batch execution failed: {e}")
                raise
    
    async def fetch_one(self, query: str, params: Optional[List] = None) -> Optional[Dict]:
        """Fetch single row as dict"""
        results = await self.execute(query, params)
        return results[0] if results else None
    
    async def create_tables(self, schema_sql: str):
        """Create tables from schema SQL"""
        async with self.get_connection() as conn:
            # Split and execute individual statements
            statements = schema_sql.split(';')
            for statement in statements:
                statement = statement.strip()
                if statement:
                    conn.execute(statement)


class DuckDBPool:
    """
    Simple connection pool for DuckDB (since DuckDB is file-based)
    """
    
    def __init__(self, db_path: str, pool_size: int = 5):
        self.db_path = db_path
        self.pool_size = pool_size
        self._connections: List[DuckDBConnection] = []
        self._available: asyncio.Queue = asyncio.Queue()
        self._lock = asyncio.Lock()
        self._initialized = False
    
    async def initialize(self):
        """Initialize connection pool"""
        if self._initialized:
            return
            
        async with self._lock:
            if self._initialized:
                return
                
            # Create connections
            for _ in range(self.pool_size):
                conn = DuckDBConnection(self.db_path)
                await conn.connect()
                self._connections.append(conn)
                await self._available.put(conn)
            
            self._initialized = True
            logger.info(f"Initialized DuckDB pool with {self.pool_size} connections")
    
    @asynccontextmanager
    async def acquire(self):
        """Acquire connection from pool"""
        if not self._initialized:
            await self.initialize()
            
        conn = await self._available.get()
        try:
            yield conn
        finally:
            await self._available.put(conn)
    
    async def close(self):
        """Close all connections in pool"""
        for conn in self._connections:
            await conn.disconnect()
        self._connections.clear()
        logger.info("Closed DuckDB connection pool")


# Global database instance
db_pool: Optional[DuckDBPool] = None


async def get_db_pool() -> DuckDBPool:
    """Get global database pool"""
    global db_pool
    if db_pool is None:
        try:
            from .config import settings
        except ImportError:
            # Fallback import for testing
            from config import settings
        
        # Use the new config method to get database path
        db_path = settings.get_database_path()
        
        db_pool = DuckDBPool(db_path)
        await db_pool.initialize()
    
    return db_pool


async def close_db_pool():
    """Close global database pool"""
    global db_pool
    if db_pool:
        await db_pool.close()
        db_pool = None