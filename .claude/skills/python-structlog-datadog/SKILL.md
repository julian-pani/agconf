---
name: python-structlog-datadog
description: COMPANY STANDARD: Required logging configuration for all Python services. Configure Python services with structlog for structured JSON logging that integrates seamlessly with Datadog. Use when setting up logging for Python services, migrating from standard logging to structlog, or implementing Datadog-compatible log formats. Handles Kubernetes deployments, async services, and multi-service architectures.
license: Apache-2.0
metadata:
  author: platform-engineering
  version: 1.3
  tags: python, logging, structlog, datadog, kubernetes, observability, company-standard
  policy: required
  scope: organization
---

# Python Structlog + Datadog Integration Skill

> **🏢 COMPANY STANDARD**: This is the required logging configuration for all Python services. All new services MUST use this configuration. Existing services should migrate during their next major refactor or feature work. No exceptions without VP Engineering approval.

This skill helps you configure Python services with structlog for production-grade structured logging that works seamlessly with Datadog.

## When to Use This Skill

- Setting up logging for new Python services
- Migrating existing services from `logging` + `python-json-logger` to structlog
- Implementing Datadog-compatible log formats
- Standardizing logging across multiple Python microservices
- Supporting Kubernetes + Datadog agent deployments

## Core Principles

1. **Datadog Reserved Attributes**: Logs use Datadog's reserved attributes for proper parsing:
   - `message` (not `event`) for the log body
   - `level` for severity (Datadog auto-maps to `status`)
   - `service` and `env` for service identification
2. **Progressive Adoption**: Can coexist with standard logging during migration
3. **Context Binding**: Bind context once (request_id, user_id) and it appears in all subsequent logs
4. **Environment-Aware**: Different configs for dev (pretty console) vs prod (JSON)
5. **Performance**: Structured logging with minimal overhead

> **Important**: The `dd.env`, `dd.service`, `dd.version` fields are reserved for APM tracing correlation.
> For plain log management (without APM), use standard attributes: `env`, `service`, `version` directly.
> Reference: https://docs.datadoghq.com/logs/log_configuration/attributes_naming_convention/

## Implementation Steps

### Step 1: Install Dependencies

Add to your `requirements.txt` or `pyproject.toml`:

```
structlog>=24.1.0
python-json-logger>=2.0.7  # Keep during migration if needed
```

### Step 2: Create Logging Configuration Module

Create `app/logging_config.py` using the provided template:

```bash
# Use the reference template
cp references/logging_config_template.py app/logging_config.py
```

Key features of this configuration:
- **Datadog reserved attributes**: Uses `message` for log body, `level` for severity (auto-mapped to `status`)
- **Timestamp format**: ISO 8601 with milliseconds
- **Service identification**: Uses `service` and `env` (not `dd.*` fields which are for APM tracing)
- **Environment detection**: Pretty console for dev, JSON for prod
- **Context propagation**: request_id, user_id, etc. automatically included
- **Correct structlog+stdlib integration**: Uses `wrap_for_formatter` pattern to prevent double-rendering

### Step 3: Initialize Logging in Your Application

Replace your existing logging setup in `main.py`:

**Old way (standard logging):**
```python
import logging.config
from pathlib import Path

BASE_DIR = Path(__file__).parent
LOGGING_CONFIG_PATH = BASE_DIR / os.environ.get('LOGGING_CONFIG_PATH', 'logging.conf')
logging.config.fileConfig(LOGGING_CONFIG_PATH, disable_existing_loggers=False)
logger = logging.getLogger(__name__)
```

**New way (structlog):**
```python
from app.logging_config import configure_logging
import structlog

# Call once at application startup
configure_logging(
    service_name="my-service",  # or from env: os.environ.get("SERVICE_NAME", "my-service")
    environment=os.environ.get("ENVIRONMENT", "development")
)

# Get logger - IMPORTANT: pass __name__ to preserve module name!
logger = structlog.get_logger(__name__)
```

### Step 4: Update Your Logging Calls

**IMPORTANT: Replace all instances of `logging.getLogger(__name__)` with `structlog.get_logger(__name__)`**
```python
# Old
import logging
logger = logging.getLogger(__name__)

# New - MUST pass __name__ to get module name in logs!
import structlog
logger = structlog.get_logger(__name__)
```

**Migration patterns - RECOMMENDED approach (human-readable + structured):**

```python
# Old style (standard logging)
logger.info(f"User {user_id} logged in from {ip_address}")
logger.error(f"Database connection failed: {error_msg}")

# New style - RECOMMENDED (human-readable message + structured fields)
logger.info(f"User {user_id} logged in from {ip_address}",
            user_id=user_id, ip_address=ip_address)
logger.error(f"Database connection failed: {error_msg}",
             error=error_msg, db="postgres")
```

**Why include both f-string message AND fields?**
- **F-string message**: Easy to read when scanning logs manually
- **Structured fields**: Searchable in Datadog (e.g., `user_id:12345`)
- **Small overhead**: Worth it for debugging benefits

**Alternative (event-based) style:**
```python
# If you prefer machine-readable event names
logger.info("user_logged_in", user_id=user_id, ip_address=ip_address)
```

**Context binding example:**
```python
# Bind context at the start of a request/workflow
log = logger.bind(request_id=request_id, user_id=user_id)

# All subsequent logs automatically include these fields
log.info(f"Request started for user {user_id}", request_id=request_id, user_id=user_id)
log.info("Fetching user data")
log.error("User not found")
# Each log will have request_id and user_id
```

### Step 5: Datadog Agent Configuration (Kubernetes)

Your logs are already compatible! The Datadog agent running on Kubernetes nodes will:

1. **Auto-detect log level**: The `status` field maps to Datadog's log level
2. **Parse JSON**: Structured fields become searchable attributes
3. **Extract service**: The `service` field populates Datadog's service facet

**No Datadog pipeline changes needed** - the configuration outputs logs in Datadog's preferred format.

Verify in Datadog:
- Logs should have `status` (not `levelname`) as the severity level
- All structured fields appear as facets
- `service` tag is automatically set

### Step 6: Remove Old Configuration Files

After migration:
```bash
rm app/logging.conf
rm app/logging-prod.conf
```

Update your Kubernetes deployment to remove the `LOGGING_CONFIG_PATH` environment variable.

## Advanced Usage

### FastAPI/Uvicorn Integration (CRITICAL for FastAPI services)

**Problem:** FastAPI/Uvicorn services add their own logging handlers that bypass structlog formatting. You'll see application logs in JSON but uvicorn logs in plain text.

**Old approach (logging.conf):**
```ini
[loggers]
keys=root,uvicorn,uvicorn.access,uvicorn.error

[logger_uvicorn]
level=INFO
handlers=default
propagate=0
qualname=uvicorn

[logger_uvicorn.access]
level=INFO
handlers=access
propagate=0
qualname=uvicorn.access
```

**New approach (built into the template):**

The template now includes **bidirectional logging integration** that routes both structlog AND standard library logs through the same formatter.

**CRITICAL: Correct structlog + stdlib integration pattern:**

When using `structlog.stdlib.LoggerFactory()`, structlog processors should NOT end with a renderer. Instead, end with `wrap_for_formatter` and let the `ProcessorFormatter` do the final rendering. This prevents double-rendering issues.

```python
# Shared processors - NO renderer here
shared_processors = [
    structlog.stdlib.add_log_level,
    structlog.stdlib.add_logger_name,
    structlog.processors.TimeStamper(fmt="iso", utc=True),
    add_service_context,
    structlog.processors.format_exc_info,
    rename_event_to_message,  # Rename 'event' to 'message' for Datadog
]

# Structlog processors - end with wrap_for_formatter, NOT a renderer
structlog_processors = shared_processors + [
    structlog.stdlib.ProcessorFormatter.wrap_for_formatter,  # MUST be last
]

# Configure structlog
structlog.configure(
    processors=structlog_processors,
    logger_factory=structlog.stdlib.LoggerFactory(),
)

# ProcessorFormatter does the actual rendering
formatter = structlog.stdlib.ProcessorFormatter(
    processor=renderer,  # JSONRenderer or ConsoleRenderer
    foreign_pre_chain=shared_processors,
)

# Configure root logger - CLEAR existing handlers first!
handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(formatter)
root_logger = logging.getLogger()
root_logger.handlers.clear()  # Prevent duplicate output
root_logger.addHandler(handler)

# Clear uvicorn's default handlers so logs propagate to root
logging.getLogger("uvicorn").handlers = []
logging.getLogger("uvicorn.access").handlers = []
logging.getLogger("uvicorn.error").handlers = []
```

**What this does:**
- `wrap_for_formatter`: Prepares event dict for stdlib `ProcessorFormatter` (no rendering yet)
- `ProcessorFormatter`: Does the actual rendering (JSON for prod, Console for dev)
- `handlers.clear()`: Prevents duplicate log output when reconfiguring
- Clear uvicorn handlers: Allows uvicorn logs to bubble up to root logger

**Result:** All logs (application + uvicorn) use consistent JSON format in production.

### Async Context Management

Structlog works seamlessly with async code:

```python
async def handle_request(request_id: str):
    log = logger.bind(request_id=request_id)
    log.info("async_operation_started")
    
    async with some_context():
        log.info("context_acquired")
        await do_work()
    
    log.info("async_operation_completed")
```

### Exception Logging

Structlog automatically captures exception info:

```python
try:
    risky_operation()
except Exception:
    logger.exception("operation_failed", operation="risky_operation")
    # Includes full traceback in 'exception' field
```

### Third-Party Library Logs

Redirect standard library logging to structlog:

```python
import logging
from app.logging_config import configure_logging

configure_logging(service_name="my-service")

# Standard logging calls now go through structlog
logging.getLogger("pymongo").info("This uses structlog now")
```

## Common Patterns

### Web Request Logging

```python
from fastapi import Request
import structlog

async def log_middleware(request: Request, call_next):
    logger = structlog.get_logger().bind(
        request_id=request.headers.get("X-Request-ID"),
        method=request.method,
        path=request.url.path
    )
    
    logger.info("request_started")
    response = await call_next(request)
    logger.info("request_completed", status_code=response.status_code)
    
    return response
```

### Background Job/Temporal Workflow

```python
@activity.defn
async def process_data(workflow_id: str, data: dict):
    log = logger.bind(
        workflow_id=workflow_id,
        activity="process_data"
    )
    
    log.info("activity_started")
    result = await do_processing(data)
    log.info("activity_completed", records_processed=len(result))
    
    return result
```

### Error Monitoring with Context

```python
try:
    result = complex_operation(user_id=123)
except ValidationError as e:
    logger.error(
        "validation_failed",
        user_id=123,
        error_type="validation",
        validation_errors=e.errors()
    )
except Exception:
    logger.exception(
        "operation_failed",
        user_id=123,
        operation="complex_operation"
    )
```

## Migration Checklist

Use this checklist when migrating an existing service:

- [ ] Install structlog dependency
- [ ] Create `app/logging_config.py` from template
- [ ] **VERIFY**: Template includes `structlog.stdlib.add_logger_name` processor
- [ ] Update `main.py` to call `configure_logging()`
- [ ] Replace `logging.getLogger(__name__)` with `structlog.get_logger(__name__)`
- [ ] **IMPORTANT**: Keep `__name__` argument in all logger instantiations
- [ ] Convert logging calls to use f-strings + structured fields
- [ ] Add context binding for requests/workflows
- [ ] Update Kubernetes deployment (remove LOGGING_CONFIG_PATH if present)
- [ ] Test locally with `ENVIRONMENT=development` (should see pretty console output)
- [ ] **VERIFY**: Module names appear in logs (e.g., `[app.main]`)
- [ ] **VERIFY (FastAPI)**: Uvicorn logs use same format as application logs
- [ ] Test in staging with `ENVIRONMENT=production` (should see JSON)
- [ ] **VERIFY (FastAPI)**: Uvicorn logs are JSON formatted (not plain text)
- [ ] Verify logs appear correctly in Datadog with proper `status` field
- [ ] **VERIFY**: Datadog logs have `logger` field with module names
- [ ] Remove old logging.conf files
- [ ] Update documentation/README

## Common Mistakes

### ❌ Forgetting to pass `__name__`

**Problem:** Module names don't appear in logs

```python
# WRONG - loses module name
logger = structlog.get_logger()

# CORRECT - preserves module name
logger = structlog.get_logger(__name__)
```

**Impact:** Without `__name__`, you lose critical debugging context. You won't know which module generated each log entry.

### ❌ Missing `add_logger_name` processor

**Problem:** Module names still don't appear even after passing `__name__`

**Fix:** Check that your `logging_config.py` includes `structlog.stdlib.add_logger_name` in the shared_processors list:

```python
shared_processors = [
    structlog.stdlib.add_log_level,
    structlog.stdlib.add_logger_name,  # ← THIS MUST BE HERE
    structlog.processors.TimeStamper(fmt="iso", utc=True),
    ...
]
```

### ❌ Losing human readability

**Problem:** Logs are machine-readable but hard for humans to scan

```python
# Works but hard to read quickly
logger.info("user_action", user_id=123, action="login")
```

**Better:** Combine human-readable messages with structured fields

```python
# Readable AND searchable
logger.info(f"User {user_id} performed action: {action}",
            user_id=user_id, action=action)
```

### ❌ Not using structured fields at all

**Problem:** Using only f-strings without structured fields

```python
# Only half the benefit
logger.info(f"User {user_id} logged in from {ip_address}")
```

**Fix:** Add the data as keyword arguments too:

```python
# Full benefits: readable + searchable in Datadog
logger.info(f"User {user_id} logged in from {ip_address}",
            user_id=user_id, ip_address=ip_address)
```

**Why this matters:** In Datadog, you can filter by `user_id:12345`, which you can't do if it's only in the message string.

### ❌ Double-rendering or malformed JSON output

**Problem:** Logs appear malformed, duplicated, or have nested JSON

**Root cause:** When using `structlog.stdlib.LoggerFactory()`, having a renderer (like `JSONRenderer` or `ConsoleRenderer`) in BOTH the structlog processors AND the `ProcessorFormatter` causes double-rendering.

**Wrong:**
```python
# BAD - renderer in both places causes double-rendering
processors = shared_processors + [
    structlog.processors.JSONRenderer()  # WRONG - renders here
]
formatter = structlog.stdlib.ProcessorFormatter(
    processor=structlog.processors.JSONRenderer(),  # AND here again!
    foreign_pre_chain=shared_processors,
)
```

**Correct:**
```python
# GOOD - only ProcessorFormatter does the rendering
structlog_processors = shared_processors + [
    structlog.stdlib.ProcessorFormatter.wrap_for_formatter,  # Prepares for formatter
]
formatter = structlog.stdlib.ProcessorFormatter(
    processor=structlog.processors.JSONRenderer(),  # Only renderer
    foreign_pre_chain=shared_processors,
)
```

### ❌ Duplicate log output

**Problem:** Each log message appears twice

**Root cause:** Python's root logger accumulates handlers. If `configure_logging()` is called multiple times (e.g., in tests), handlers pile up.

**Fix:** Clear handlers before adding new ones:
```python
root_logger = logging.getLogger()
root_logger.handlers.clear()  # Add this line!
root_logger.addHandler(handler)
```

### ❌ Uvicorn logs not formatted (FastAPI only)

**Problem:** Application logs are JSON but uvicorn access logs are in plain text format

**Symptoms:**
```
# Application logs (correct JSON)
{"timestamp":"2025-12-28T15:35:09.060Z","message":"Getting session","level":"info"...}

# Uvicorn logs (wrong - plain text)
INFO:     127.0.0.1:54321 - "GET /health HTTP/1.1" 200 OK
```

**Root cause:** Uvicorn adds its own handlers during startup that bypass structlog formatting.

**Fix:** The template now includes handler clearing (lines 169-173). If you used an older version of the template, update your `logging_config.py`:

```python
# Add this AFTER configuring structlog
logging.getLogger("uvicorn").handlers = []
logging.getLogger("uvicorn.access").handlers = []
logging.getLogger("uvicorn.error").handlers = []
```

Also ensure you're using `ProcessorFormatter` instead of `logging.basicConfig()` (see the updated template).

**Migration from old .conf files:**
If your old setup had `propagate=0` for uvicorn loggers, the new approach does the opposite:
- Old: Separate handlers per logger, no propagation
- New: Clear handlers, allow propagation to root logger with structlog formatter

## Example Output

With module names correctly configured, your logs will include the logger field:

**Development (console):**
```
2025-12-28T15:35:09.060Z  Getting session abc-123  [app.main]  session_id=abc-123 user_id=123 level=info
```

**Production (JSON):**
```json
{
  "timestamp": "2025-12-28T15:35:09.060Z",
  "message": "Getting session abc-123",
  "logger": "app.main",
  "session_id": "abc-123",
  "user_id": 123,
  "level": "info",
  "service": "medbuddy",
  "env": "production"
}
```

**Key Datadog reserved attributes used:**
- `message`: The log body (Datadog's reserved attribute, renamed from structlog's `event`)
- `level`: Severity level (Datadog auto-maps this to `status` for filtering)
- `service`: Service name
- `env`: Environment (NOT `dd.env` - that's for APM tracing only)

Notice the `logger` field (module name) and how data appears in both the message AND as searchable fields.

## Troubleshooting

### Module names not appearing in logs

**Symptoms:** Logs work but don't show `[module.name]` in console or `logger` field in JSON

**Fix:** Check both:
1. Template has `structlog.stdlib.add_logger_name` processor (see Common Mistakes above)
2. All logger instantiations use `structlog.get_logger(__name__)` with `__name__` argument

### Uvicorn logs in wrong format (FastAPI only)

**Symptoms:** Application logs are JSON in production, but uvicorn logs are plain text:
```
{"timestamp":"...","level":"info",...}  ← App logs (correct)
INFO:     127.0.0.1:54321 - "GET /health HTTP/1.1" 200 OK  ← Uvicorn (wrong)
```

**Fix:** See the "Uvicorn logs not formatted" section in Common Mistakes above. Ensure:
1. Your `logging_config.py` uses `ProcessorFormatter` (not `logging.basicConfig`)
2. Uvicorn handlers are cleared after configuring structlog
3. The template from references/ has been updated with these fixes

### Logs not showing correct level in Datadog

Check that:
1. Your logs have a `level` field (Datadog auto-maps this to `status`)
2. The level values are lowercase: "info", "error", "warning", "debug"
3. The Datadog agent is collecting JSON logs correctly

Note: You can use either `level` or `status` - Datadog recognizes both. The `level` field is automatically mapped to `status` by Datadog.

### Pretty console not working in development

Ensure:
```python
configure_logging(environment="development")  # Not "prod" or "production"
```

### Context not persisting across log calls

Remember to bind and use the returned logger:
```python
# Wrong
logger.bind(request_id=req_id)
logger.info("test")  # request_id won't appear

# Correct
log = logger.bind(request_id=req_id)
log.info("test")  # request_id appears
```

### Third-party libraries not logging

Standard logging is automatically redirected to structlog. If logs still don't appear:
```python
import logging
logging.getLogger("library_name").setLevel(logging.INFO)
```

## Reference Files

- **logging_config_template.py**: Complete implementation of the logging configuration
- **datadog_fields.md**: Detailed explanation of Datadog field mappings
- **migration_examples.md**: Side-by-side examples of old vs new logging patterns

## Examples

See the `references/` directory for:
- Complete FastAPI application example
- Temporal workflow logging example
- Multi-service logging patterns
- Custom processor examples
