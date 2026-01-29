# Structlog Quick Reference

Quick reference for common structlog patterns with Datadog integration.

## Setup (Do Once)

```python
from app.logging_config import configure_logging
import structlog

configure_logging(
    service_name="my-service",
    environment="production"
)

logger = structlog.get_logger()
```

## Basic Logging

```python
# Simple log
logger.info("user_logged_in")

# With fields
logger.info("user_logged_in", user_id=123, email="user@example.com")

# Different levels
logger.debug("debugging_info", step=1)
logger.info("normal_operation", status="ok")
logger.warning("rate_limit_approaching", requests=95, limit=100)
logger.error("operation_failed", error_code="INVALID_INPUT")
logger.critical("system_failure", component="database")
```

## Context Binding

```python
# Bind context once
log = logger.bind(request_id=req_id, user_id=user_id)

# All subsequent logs have these fields
log.info("request_started")
log.info("processing_payment")
log.info("request_completed")
```

## Exception Logging

```python
try:
    risky_operation()
except Exception:
    logger.exception("operation_failed", operation="risky_operation")
    # Full traceback automatically included
```

## FastAPI Middleware

```python
@app.middleware("http")
async def logging_middleware(request: Request, call_next):
    request_id = str(uuid4())
    log = logger.bind(
        request_id=request_id,
        method=request.method,
        path=request.url.path
    )
    request.state.log = log
    
    log.info("request_started")
    response = await call_next(request)
    log.info("request_completed", status_code=response.status_code)
    
    return response
```

## FastAPI Dependency

```python
def get_logger(request: Request) -> structlog.BoundLogger:
    return request.state.log

@app.get("/users/{user_id}")
async def get_user(
    user_id: int,
    log: structlog.BoundLogger = Depends(get_logger)
):
    log = log.bind(user_id=user_id)
    log.info("fetching_user")
    # ...
```

## Temporal Activity

```python
@activity.defn
async def process_data(workflow_id: str):
    log = logger.bind(
        workflow_id=workflow_id,
        activity="process_data",
        attempt=activity.info().attempt
    )
    
    log.info("activity_started")
    # ...
    log.info("activity_completed", records=100)
```

## Background Task

```python
def send_email(user_id: int, email: str):
    log = logger.bind(
        task="send_email",
        user_id=user_id
    )
    
    log.info("task_started")
    # ...
    log.info("task_completed", success=True)
```

## Progress Tracking

```python
total = 1000
for i in range(0, total, 100):
    log.info(
        "processing_batch",
        batch_start=i,
        batch_end=min(i+100, total),
        progress_pct=(i/total)*100
    )
```

## Error with Context

```python
logger.error(
    "database_error",
    error_type="connection_timeout",
    db_host="postgres-primary",
    retry_count=3,
    user_id=user_id
)
```

## Datadog Queries

```bash
# Find all logs for a request
service:my-service @request_id:abc-123

# Find all errors for a user
service:my-service @status:error @user_id:456

# Find slow operations
service:my-service @duration_ms:>1000

# Find specific error types
service:my-service @error_type:database_error

# Combine filters
service:my-service @status:error @workflow_id:* @retry_count:>2
```

## Environment-Specific Output

```bash
# Development (pretty console)
ENVIRONMENT=development python main.py
# Output: 2025-01-15 10:30:00 [info] user_logged_in user_id=123

# Production (JSON)
ENVIRONMENT=production python main.py
# Output: {"message":"user_logged_in","level":"info","timestamp":"2025-01-15T10:30:00.123Z","user_id":123,"service":"my-service","env":"production"}
```

**Note on Datadog reserved attributes:**
- `message`: Log body (Datadog reserved attribute, renamed from structlog's `event`)
- `level`: Severity (Datadog auto-maps to `status`)
- `env`: Environment (NOT `dd.env` - that's for APM tracing only)

## Common Patterns

### Request Lifecycle
```python
log = logger.bind(request_id=req_id)
log.info("request_received", method="POST", path="/users")
log.info("validating_input")
log.info("calling_database", query="SELECT")
log.info("response_sent", status_code=200, duration_ms=45)
```

### Database Transaction
```python
log = logger.bind(transaction_id=tx_id)
log.info("transaction_started")
log.info("executing_query", table="users", operation="UPDATE")
log.info("transaction_committed")
```

### External API Call
```python
log.info("api_call_started", service="payment_gateway", endpoint="/charge")
log.info("api_call_completed", status_code=200, duration_ms=234)
```

### File Processing
```python
log = logger.bind(file_id=file_id, filename=filename)
log.info("file_processing_started", size_bytes=file_size)
log.info("file_validated")
log.info("file_processed", records_extracted=123)
```

## Third-Party Library Logs

```python
import logging

# Configure after calling configure_logging()
logging.getLogger("pymongo").setLevel(logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)
```

## Testing Logs

```python
import pytest
from structlog.testing import CapturingLogger

def test_my_function(caplog):
    # Your test here
    # Check logs were created
    assert any("user_logged_in" in record for record in caplog.records)
```

## Tips

1. **Use snake_case event names**: `user_logged_in` not `"User logged in"`
2. **Add context early**: Bind request_id, user_id at the start
3. **Be specific**: `db_connection_failed` > `error`
4. **Include relevant fields**: Always add fields that help debugging
5. **Avoid PII**: Don't log passwords, tokens, credit cards
6. **Use structured data**: Pass integers as integers, not strings
7. **Exception logging**: Use `.exception()` not `.error()` for exceptions

## Migration Shortcuts

```python
# Old → New
logging.getLogger(__name__) → structlog.get_logger()
logger.info("msg", extra={}) → logger.info("event", key=value)
extra={"k": v} → k=v
logging.config.fileConfig() → configure_logging()
```
