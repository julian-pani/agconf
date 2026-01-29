"""
Complete FastAPI application example with structlog + Datadog logging.

This example demonstrates:
- Request-level context binding
- Middleware for automatic request logging
- Exception handling with structured logging
- Background task logging
- Dependency injection of logger with context

Run with:
    ENVIRONMENT=development python fastapi_example.py  # Pretty console
    ENVIRONMENT=production python fastapi_example.py   # JSON output

Production JSON output uses Datadog reserved attributes:
- `message`: Log body (renamed from structlog's `event`)
- `level`: Severity (Datadog auto-maps to `status`)
- `service` and `env`: Service identification (NOT `dd.env` - that's for APM tracing)

Requires: logging_config_template.py (copy to logging_config.py in same directory)
"""

import os
import time
from contextlib import asynccontextmanager
from typing import Optional
from uuid import uuid4

import structlog
import uvicorn
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request, Response
from pydantic import BaseModel

# Import your logging configuration
# In a real app: from app.logging_config import configure_logging
# For this example, we'll assume it's in the same directory
from logging_config import configure_logging

# Configure logging at module load
configure_logging(
    service_name=os.environ.get("SERVICE_NAME", "fastapi-example"),
    environment=os.environ.get("ENVIRONMENT", "development"),
)

# Get base logger
base_logger = structlog.get_logger()


# Models
class User(BaseModel):
    id: int
    name: str
    email: str


class CreateUserRequest(BaseModel):
    name: str
    email: str


# Lifespan context manager for startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events with logging."""
    base_logger.info("application_starting", version="1.0.0")
    yield
    base_logger.info("application_shutting_down")


# Create FastAPI app
app = FastAPI(title="Structlog Example", lifespan=lifespan)


# Dependency to get logger with request context
def get_logger(request: Request) -> structlog.BoundLogger:
    """
    Dependency that provides a logger with request context already bound.
    
    Usage in endpoint:
        async def my_endpoint(log: structlog.BoundLogger = Depends(get_logger)):
            log.info("doing_something")
    """
    return request.state.log


# Middleware for request logging
@app.middleware("http")
async def logging_middleware(request: Request, call_next):
    """
    Middleware that:
    1. Generates request_id
    2. Binds request context to logger
    3. Logs request start/completion
    4. Stores logger in request.state for endpoint access
    """
    request_id = request.headers.get("X-Request-ID") or str(uuid4())
    
    # Bind request context
    log = base_logger.bind(
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        client_ip=request.client.host if request.client else None,
    )
    
    # Store in request state for endpoints to access
    request.state.log = log
    
    # Log request start
    start_time = time.time()
    log.info("request_started")
    
    try:
        # Process request
        response: Response = await call_next(request)
        
        # Log successful completion
        duration_ms = (time.time() - start_time) * 1000
        log.info(
            "request_completed",
            status_code=response.status_code,
            duration_ms=round(duration_ms, 2),
        )
        
        # Add request_id to response headers
        response.headers["X-Request-ID"] = request_id
        
        return response
        
    except Exception as e:
        # Log error with exception details
        duration_ms = (time.time() - start_time) * 1000
        log.exception(
            "request_failed",
            error_type=type(e).__name__,
            duration_ms=round(duration_ms, 2),
        )
        raise


# Simulated database
USERS_DB = {
    1: User(id=1, name="Alice", email="alice@example.com"),
    2: User(id=2, name="Bob", email="bob@example.com"),
}


# Background task example
def send_welcome_email(user_id: int, email: str):
    """Background task that runs after user creation."""
    log = base_logger.bind(
        task="send_welcome_email",
        user_id=user_id,
        email=email,
    )
    
    log.info("background_task_started")
    
    try:
        # Simulate email sending
        time.sleep(0.5)
        log.info("welcome_email_sent", success=True)
        
    except Exception:
        log.exception("background_task_failed")


# Endpoints
@app.get("/")
async def root(log: structlog.BoundLogger = Depends(get_logger)):
    """Health check endpoint."""
    log.info("health_check", status="healthy")
    return {"status": "healthy", "service": "fastapi-example"}


@app.get("/users/{user_id}")
async def get_user(
    user_id: int,
    log: structlog.BoundLogger = Depends(get_logger),
) -> User:
    """
    Get user by ID.
    
    Demonstrates:
    - Using logger from dependency injection
    - Adding user_id to context
    - Structured error logging
    """
    # Bind user_id to all logs in this handler
    log = log.bind(user_id=user_id)
    
    log.info("fetching_user")
    
    user = USERS_DB.get(user_id)
    
    if not user:
        log.warning("user_not_found")
        raise HTTPException(status_code=404, detail="User not found")
    
    log.info("user_fetched", user_name=user.name)
    return user


@app.get("/users")
async def list_users(
    limit: Optional[int] = 10,
    log: structlog.BoundLogger = Depends(get_logger),
) -> list[User]:
    """
    List users with optional limit.
    
    Demonstrates:
    - Query parameter logging
    - Logging collection sizes
    """
    log = log.bind(limit=limit)
    log.info("listing_users")
    
    users = list(USERS_DB.values())[:limit]
    
    log.info("users_listed", user_count=len(users))
    return users


@app.post("/users")
async def create_user(
    request: CreateUserRequest,
    background_tasks: BackgroundTasks,
    log: structlog.BoundLogger = Depends(get_logger),
) -> User:
    """
    Create new user and send welcome email in background.
    
    Demonstrates:
    - Request body logging
    - Background task with logging
    - Structured success logging
    """
    log.info("creating_user", name=request.name, email=request.email)
    
    # Create user
    new_id = max(USERS_DB.keys()) + 1 if USERS_DB else 1
    new_user = User(id=new_id, name=request.name, email=request.email)
    USERS_DB[new_id] = new_user
    
    log = log.bind(user_id=new_id)
    log.info("user_created", user_id=new_id)
    
    # Schedule background task
    background_tasks.add_task(send_welcome_email, new_id, request.email)
    log.info("background_task_scheduled", task="send_welcome_email")
    
    return new_user


@app.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    log: structlog.BoundLogger = Depends(get_logger),
) -> dict:
    """
    Delete user by ID.
    
    Demonstrates:
    - Delete operation logging
    - Not found error handling
    """
    log = log.bind(user_id=user_id)
    log.info("deleting_user")
    
    if user_id not in USERS_DB:
        log.warning("user_not_found_for_deletion")
        raise HTTPException(status_code=404, detail="User not found")
    
    del USERS_DB[user_id]
    log.info("user_deleted")
    
    return {"status": "deleted", "user_id": user_id}


@app.get("/error")
async def trigger_error(log: structlog.BoundLogger = Depends(get_logger)):
    """
    Endpoint that deliberately raises an error.
    
    Demonstrates exception logging with full traceback.
    """
    log.info("triggering_error_for_demo")
    
    try:
        # Deliberate error
        result = 1 / 0
    except ZeroDivisionError:
        log.exception("division_error_occurred", operation="1/0")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/slow")
async def slow_endpoint(
    delay: float = 2.0,
    log: structlog.BoundLogger = Depends(get_logger),
):
    """
    Slow endpoint for testing request duration logging.
    
    Demonstrates:
    - Duration tracking
    - Progress logging for long operations
    """
    log = log.bind(delay_seconds=delay)
    log.info("slow_operation_started")
    
    # Simulate slow work
    time.sleep(delay)
    
    log.info("slow_operation_completed")
    return {"status": "completed", "delay": delay}


# Alternative: Manual context manager for database operations
class DatabaseContext:
    """Example context manager with logging."""
    
    def __init__(self, log: structlog.BoundLogger, operation: str):
        self.log = log.bind(db_operation=operation)
        self.operation = operation
    
    def __enter__(self):
        self.log.info("db_operation_started")
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.log.exception("db_operation_failed")
        else:
            self.log.info("db_operation_completed")


@app.get("/users/{user_id}/with-context")
async def get_user_with_context(
    user_id: int,
    log: structlog.BoundLogger = Depends(get_logger),
) -> User:
    """
    Example using context manager for database-like operations.
    """
    log = log.bind(user_id=user_id)
    
    with DatabaseContext(log, "get_user"):
        user = USERS_DB.get(user_id)
        
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        return user


if __name__ == "__main__":
    # Run the application
    # The middleware will log all requests automatically
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_config=None,  # Disable uvicorn's default logging config
    )
