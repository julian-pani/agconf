# Migration Examples: Standard Logging → Structlog

This document provides side-by-side examples of common logging patterns, showing how to migrate from standard logging with `python-json-logger` to structlog.

## Basic Logging

### Old Way (Standard Logging)
```python
import logging

logger = logging.getLogger(__name__)

# Simple log
logger.info("User logged in")

# Log with extra fields
logger.info("User logged in", extra={"user_id": 123, "email": "user@example.com"})

# Error with extra fields
logger.error("Database connection failed", extra={"db": "postgres", "retry": 3})
```

### New Way (Structlog)
```python
import structlog

logger = structlog.get_logger()

# Simple log (but use event names instead of messages)
logger.info("user_logged_in")

# Log with fields (no 'extra' needed!)
logger.info("user_logged_in", user_id=123, email="user@example.com")

# Error with fields
logger.error("db_connection_failed", db="postgres", retry=3)
```

**Key differences:**
- No `extra={}` dictionary needed
- Use snake_case event names instead of sentences
- Fields are passed as keyword arguments

---

## Logging with Context

### Old Way (Standard Logging)
```python
import logging

logger = logging.getLogger(__name__)

def handle_request(request_id: str, user_id: int):
    # Must pass extra to EVERY log call
    logger.info("Request started", extra={"request_id": request_id, "user_id": user_id})
    logger.info("Fetching user data", extra={"request_id": request_id, "user_id": user_id})
    logger.info("Request completed", extra={"request_id": request_id, "user_id": user_id})
    # Easy to forget extra={} or make typos
```

### New Way (Structlog)
```python
import structlog

logger = structlog.get_logger()

def handle_request(request_id: str, user_id: int):
    # Bind context ONCE
    log = logger.bind(request_id=request_id, user_id=user_id)
    
    # Context automatically included in all subsequent logs
    log.info("request_started")
    log.info("fetching_user_data")
    log.info("request_completed")
```

**Key differences:**
- Bind context once at the start
- All subsequent logs automatically include the bound context
- Cleaner, less error-prone code

---

## Exception Logging

### Old Way (Standard Logging)
```python
import logging

logger = logging.getLogger(__name__)

try:
    result = risky_operation(user_id=123)
except ValueError as e:
    logger.exception("Operation failed: %s", str(e), extra={"user_id": 123})
```

### New Way (Structlog)
```python
import structlog

logger = structlog.get_logger()

try:
    result = risky_operation(user_id=123)
except ValueError as e:
    logger.exception("operation_failed", user_id=123, error_type="validation")
```

**Key differences:**
- Same `logger.exception()` method
- Exception traceback automatically captured
- Fields passed as kwargs instead of extra

---

## FastAPI/Web Framework Integration

### Old Way (Standard Logging + python-json-logger)
```python
import logging
from fastapi import FastAPI, Request
from uuid import uuid4

logger = logging.getLogger(__name__)

app = FastAPI()

@app.middleware("http")
async def log_requests(request: Request, call_next):
    request_id = str(uuid4())
    
    logger.info(
        "Request started",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path
        }
    )
    
    response = await call_next(request)
    
    logger.info(
        "Request completed",
        extra={
            "request_id": request_id,
            "status_code": response.status_code
        }
    )
    
    return response

@app.get("/users/{user_id}")
async def get_user(user_id: int):
    logger.info("Fetching user", extra={"user_id": user_id})
    # Must remember to add extra everywhere
    return {"user_id": user_id}
```

### New Way (Structlog)
```python
import structlog
from fastapi import FastAPI, Request
from uuid import uuid4

logger = structlog.get_logger()

app = FastAPI()

@app.middleware("http")
async def log_requests(request: Request, call_next):
    request_id = str(uuid4())
    
    # Bind context and store in request state
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

@app.get("/users/{user_id}")
async def get_user(user_id: int, request: Request):
    # Access logger from request state with context already bound
    log = request.state.log.bind(user_id=user_id)
    log.info("fetching_user")
    return {"user_id": user_id}
```

**Key differences:**
- Logger with context stored in request state
- Automatic context propagation throughout request lifecycle
- Cleaner endpoint code

---

## Background Job / Temporal Workflow

### Old Way (Standard Logging)
```python
import logging

logger = logging.getLogger(__name__)

def process_payment(workflow_id: str, payment_id: str, amount: float):
    logger.info(
        "Processing payment",
        extra={
            "workflow_id": workflow_id,
            "payment_id": payment_id,
            "amount": amount
        }
    )
    
    # Validate
    logger.info(
        "Validating payment",
        extra={"workflow_id": workflow_id, "payment_id": payment_id}
    )
    
    # Charge
    logger.info(
        "Charging card",
        extra={"workflow_id": workflow_id, "payment_id": payment_id}
    )
    
    # Complete
    logger.info(
        "Payment completed",
        extra={
            "workflow_id": workflow_id,
            "payment_id": payment_id,
            "success": True
        }
    )
```

### New Way (Structlog)
```python
import structlog

logger = structlog.get_logger()

def process_payment(workflow_id: str, payment_id: str, amount: float):
    log = logger.bind(
        workflow_id=workflow_id,
        payment_id=payment_id,
        amount=amount
    )
    
    log.info("payment_processing_started")
    
    # Validate
    log.info("validating_payment")
    
    # Charge
    log.info("charging_card")
    
    # Complete
    log.info("payment_completed", success=True)
```

**Key differences:**
- Context bound once at function start
- Much cleaner, less repetitive
- Easy to track workflow through Datadog with workflow_id

---

## Third-Party Library Integration

### Old Way (Standard Logging Config)
```python
# In logging-prod.conf
[logger_pymongo]
level=INFO
handlers=consoleHandler
qualname=pymongo
propagate=0

[logger_uvicorn]
level=INFO
handlers=consoleHandler
qualname=uvicorn
propagate=0
```

### New Way (Structlog + Standard Logging Interop)
```python
# In logging_config.py or after calling configure_logging()
import logging

# Set levels for third-party loggers
logging.getLogger("pymongo").setLevel(logging.INFO)
logging.getLogger("uvicorn").setLevel(logging.INFO)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

# Their logs now automatically go through structlog!
```

**Key differences:**
- No separate config file needed
- Standard logging automatically redirected to structlog
- All logs (yours + third-party) have consistent format

---

## Application Startup

### Old Way (main.py)
```python
import logging
import logging.config
from pathlib import Path
import os

BASE_DIR = Path(__file__).parent
LOGGING_CONFIG_PATH = BASE_DIR / os.environ.get('LOGGING_CONFIG_PATH', 'logging.conf')
print(f"Resolved logging config path: {LOGGING_CONFIG_PATH}")
logging.config.fileConfig(LOGGING_CONFIG_PATH, disable_existing_loggers=False)
logger = logging.getLogger(__name__)

logger.info("Application starting")
```

### New Way (main.py)
```python
import os
from app.logging_config import configure_logging
import structlog

# Configure logging once at startup
configure_logging(
    service_name=os.environ.get("SERVICE_NAME", "my-service"),
    environment=os.environ.get("ENVIRONMENT", "development")
)

logger = structlog.get_logger()
logger.info("application_starting")
```

**Key differences:**
- No more .conf files
- Environment-aware (auto-detects dev vs prod)
- Service name from environment variable
- Simpler, more maintainable

---

## Kubernetes Deployment Changes

### Old Way (deployment.yaml)
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-service
spec:
  template:
    spec:
      containers:
      - name: my-service
        image: my-service:latest
        env:
        - name: LOGGING_CONFIG_PATH
          value: "logging-prod.conf"
```

### New Way (deployment.yaml)
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-service
spec:
  template:
    spec:
      containers:
      - name: my-service
        image: my-service:latest
        env:
        - name: SERVICE_NAME
          value: "my-service"
        - name: ENVIRONMENT
          value: "production"
```

**Key differences:**
- Remove `LOGGING_CONFIG_PATH`
- Add `SERVICE_NAME` and `ENVIRONMENT`
- Datadog automatically picks up service name from logs

---

## Development vs Production

### Old Way
Requires two separate config files:
- `logging.conf` - Development (console formatter)
- `logging-prod.conf` - Production (JSON formatter)

Switch via environment variable: `LOGGING_CONFIG_PATH=logging-prod.conf`

### New Way
Single configuration that auto-detects environment:

```python
# Automatically uses pretty console for development
configure_logging(environment="development")

# Automatically uses JSON for production
configure_logging(environment="production")
```

**Development output:**
```
2025-01-15 10:30:00 [info     ] user_logged_in    user_id=123 email=user@example.com
```

**Production output:**
```json
{"message": "user_logged_in", "level": "info", "timestamp": "2025-01-15T10:30:00.123Z", "service": "my-service", "env": "production", "user_id": 123, "email": "user@example.com"}
```

**Note on Datadog reserved attributes:**
- `message`: Log body (Datadog reserved attribute, renamed from structlog's `event`)
- `level`: Severity (Datadog auto-maps to `status`)
- `env`: Environment (NOT `dd.env` - that's for APM tracing only)

---

## Complete Before/After Example

### Before: Full Application with Standard Logging

**File structure:**
```
my-service/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── logging.conf
│   └── logging-prod.conf
└── requirements.txt
```

**app/main.py:**
```python
import logging
import logging.config
from pathlib import Path
import os
from fastapi import FastAPI, Request

BASE_DIR = Path(__file__).parent
LOGGING_CONFIG_PATH = BASE_DIR / os.environ.get('LOGGING_CONFIG_PATH', 'logging.conf')
logging.config.fileConfig(LOGGING_CONFIG_PATH, disable_existing_loggers=False)
logger = logging.getLogger(__name__)

app = FastAPI()

@app.get("/users/{user_id}")
async def get_user(user_id: int):
    logger.info("Fetching user", extra={"user_id": user_id})
    return {"user_id": user_id}

if __name__ == "__main__":
    logger.info("Application starting")
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

**requirements.txt:**
```
fastapi
uvicorn
python-json-logger
```

---

### After: Full Application with Structlog

**File structure:**
```
my-service/
├── app/
│   ├── __init__.py
│   ├── main.py
│   └── logging_config.py
└── requirements.txt
```

**app/logging_config.py:**
```python
# Copy the template from references/logging_config_template.py
```

**app/main.py:**
```python
import os
from app.logging_config import configure_logging
import structlog
from fastapi import FastAPI, Request

# Configure logging at startup
configure_logging(
    service_name=os.environ.get("SERVICE_NAME", "my-service"),
    environment=os.environ.get("ENVIRONMENT", "development")
)

logger = structlog.get_logger()
app = FastAPI()

@app.get("/users/{user_id}")
async def get_user(user_id: int):
    logger.info("fetching_user", user_id=user_id)
    return {"user_id": user_id}

if __name__ == "__main__":
    logger.info("application_starting")
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

**requirements.txt:**
```
fastapi
uvicorn
structlog
```

**What was removed:**
- ❌ `logging.conf`
- ❌ `logging-prod.conf`
- ❌ `python-json-logger` dependency
- ❌ `LOGGING_CONFIG_PATH` environment variable

**What was added:**
- ✅ `logging_config.py` module
- ✅ `structlog` dependency
- ✅ `SERVICE_NAME` and `ENVIRONMENT` env vars (optional)

---

## Quick Migration Checklist

1. **Install structlog:**
   ```bash
   pip install structlog
   ```

2. **Add logging_config.py:**
   ```bash
   cp references/logging_config_template.py app/logging_config.py
   ```

3. **Update main.py:**
   ```python
   # Old
   import logging.config
   logging.config.fileConfig(...)
   logger = logging.getLogger(__name__)
   
   # New
   from app.logging_config import configure_logging
   import structlog
   configure_logging(service_name="my-service", environment="production")
   logger = structlog.get_logger()
   ```

4. **Update log calls:**
   ```python
   # Old
   logger.info("message", extra={"key": "value"})
   
   # New
   logger.info("event_name", key="value")
   ```

5. **Update Kubernetes deployment:**
   ```yaml
   # Remove
   - name: LOGGING_CONFIG_PATH
   
   # Add
   - name: SERVICE_NAME
     value: "my-service"
   - name: ENVIRONMENT
     value: "production"
   ```

6. **Delete old config files:**
   ```bash
   rm app/logging.conf app/logging-prod.conf
   ```

7. **Test locally:**
   ```bash
   ENVIRONMENT=development python app/main.py
   # Should see pretty console output
   
   ENVIRONMENT=production python app/main.py
   # Should see JSON output
   ```

8. **Verify in Datadog:**
   - Check that `level` field appears (Datadog auto-maps to `status`)
   - Verify `service` and `env` are set correctly
   - Confirm custom fields are searchable
