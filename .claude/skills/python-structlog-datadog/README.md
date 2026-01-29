# Python Structlog + Datadog Integration Skill

A comprehensive agent skill for configuring Python services with structlog for production-grade structured logging that integrates seamlessly with Datadog.

## Overview

This skill helps you:
- Set up structlog with Datadog-compatible output
- Migrate from standard `logging` + `python-json-logger` to structlog
- Implement consistent logging across multiple Python microservices
- Support Kubernetes + Datadog agent deployments
- Bind context (request_id, user_id) that automatically appears in all logs

## Quick Start

### For New Services

1. Install dependencies:
   ```bash
   pip install structlog
   ```

2. Copy the logging configuration:
   ```bash
   cp references/logging_config_template.py app/logging_config.py
   ```

3. Initialize in your `main.py`:
   ```python
   from app.logging_config import configure_logging
   import structlog
   
   configure_logging(
       service_name="my-service",
       environment="production"
   )
   
   logger = structlog.get_logger()
   logger.info("application_started")
   ```

### For Existing Services

1. Run the migration script:
   ```bash
   python scripts/migrate_to_structlog.py /path/to/project --dry-run
   python scripts/migrate_to_structlog.py /path/to/project --apply
   ```

2. Follow the manual migration checklist in `references/migration_examples.md`

3. Update Kubernetes deployment to set `SERVICE_NAME` and `ENVIRONMENT` env vars

4. Verify logs in Datadog have `status` field (not `levelname`)

## Key Features

### 1. Datadog-Native Field Mapping

Automatically maps Python log levels to Datadog's `status` field:
- `DEBUG` → `"status": "debug"`
- `INFO` → `"status": "info"`
- `WARNING` → `"status": "warn"`
- `ERROR` → `"status": "error"`
- `CRITICAL` → `"status": "critical"`

### 2. Context Binding

Bind context once and it appears in all subsequent logs:

```python
log = logger.bind(request_id=req_id, user_id=user_id)
log.info("request_started")
log.info("processing_data")
log.info("request_completed")
# All three logs include request_id and user_id
```

### 3. Environment-Aware Configuration

Automatically detects environment and adjusts output:
- **Development**: Pretty console output with colors
- **Production**: JSON output for Datadog

### 4. Zero Datadog Configuration

No Datadog pipeline changes needed - logs are already in the correct format!

## What's Included

### Documentation
- **SKILL.md**: Complete implementation guide
- **references/datadog_fields.md**: Detailed Datadog field mappings
- **references/migration_examples.md**: Side-by-side migration examples
- **README.md**: This file

### Templates & Examples
- **references/logging_config_template.py**: Copy this to your project
- **references/fastapi_example.py**: Complete FastAPI application example
- **references/temporal_example.py**: Temporal workflow/activity example

### Scripts
- **scripts/migrate_to_structlog.py**: Automated migration assistance

## Directory Structure

```
python-structlog-datadog/
├── SKILL.md                              # Main skill documentation
├── README.md                             # This file
├── references/
│   ├── logging_config_template.py        # Main template to copy
│   ├── datadog_fields.md                 # Datadog field documentation
│   ├── migration_examples.md             # Migration patterns
│   ├── fastapi_example.py                # FastAPI example
│   └── temporal_example.py               # Temporal example
└── scripts/
    └── migrate_to_structlog.py           # Migration script
```

## Common Use Cases

### Web Service (FastAPI/Flask)
See: `references/fastapi_example.py`

```python
from fastapi import FastAPI, Request
import structlog

@app.middleware("http")
async def logging_middleware(request: Request, call_next):
    log = logger.bind(
        request_id=request.headers.get("X-Request-ID"),
        method=request.method,
        path=request.url.path
    )
    request.state.log = log
    
    log.info("request_started")
    response = await call_next(request)
    log.info("request_completed", status_code=response.status_code)
    
    return response
```

### Background Jobs / Temporal
See: `references/temporal_example.py`

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

### Error Monitoring

```python
try:
    result = risky_operation(user_id=123)
except Exception:
    logger.exception(
        "operation_failed",
        user_id=123,
        operation="risky_operation"
    )
```

## Migration Checklist

- [ ] Install structlog dependency
- [ ] Copy `logging_config_template.py` to `app/logging_config.py`
- [ ] Update `main.py` to call `configure_logging()`
- [ ] Replace `logging.getLogger(__name__)` with `structlog.get_logger()`
- [ ] Convert `logger.info("message", extra={})` to `logger.info("event", key=value)`
- [ ] Add context binding for requests/workflows
- [ ] Update Kubernetes deployment (remove `LOGGING_CONFIG_PATH`, add `SERVICE_NAME` and `ENVIRONMENT`)
- [ ] Test locally with `ENVIRONMENT=development`
- [ ] Test in staging with `ENVIRONMENT=production`
- [ ] Verify logs in Datadog with proper `status` field
- [ ] Remove old `logging.conf` files
- [ ] Update documentation/README

## Troubleshooting

### Logs not showing correct level in Datadog
Check that your logs have a `status` field (not `levelname`) with lowercase values: "info", "error", "warn", "debug".

### Pretty console not working in development
Ensure: `configure_logging(environment="development")`

### Context not persisting across log calls
Remember to bind and use the returned logger:
```python
log = logger.bind(request_id=req_id)  # Correct
log.info("test")  # Context appears
```

### Third-party libraries not logging
Standard logging is automatically redirected. If needed:
```python
import logging
logging.getLogger("library_name").setLevel(logging.INFO)
```

## Support

For detailed implementation guidance, see `SKILL.md`.
For migration examples, see `references/migration_examples.md`.
For Datadog field mapping details, see `references/datadog_fields.md`.

## License

Apache-2.0
