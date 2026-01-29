# Datadog Field Mappings

This document explains how the structlog configuration maps Python logging concepts to Datadog's log management fields.

Reference: https://docs.datadoghq.com/logs/log_configuration/attributes_naming_convention/

## Datadog Reserved Attributes

Datadog has specific reserved attributes that are automatically recognized and processed. Our structlog configuration uses these correctly:

### `message` (NOT `event`)

**Critical**: Datadog uses `message` as the reserved attribute for the log body.

- Structlog uses `event` by default
- Our configuration includes a `rename_event_to_message` processor to fix this
- Without this, Datadog won't recognize your log message properly

```python
# Our processor renames 'event' to 'message'
def rename_event_to_message(logger, method_name, event_dict):
    if "event" in event_dict:
        event_dict["message"] = event_dict.pop("event")
    return event_dict
```

### `level` (Datadog auto-maps to `status`)

Datadog automatically maps `level` to `status` for severity filtering.

| Python Logging | Output `level` | Datadog `status` |
|----------------|----------------|------------------|
| `DEBUG` | `"debug"` | Debug severity |
| `INFO` | `"info"` | Info severity |
| `WARNING` | `"warning"` | Warning severity |
| `ERROR` | `"error"` | Error severity |
| `CRITICAL` | `"critical"` | Critical severity |

You can use either `level` or `status` directly - both work. We use `level` because structlog's `add_log_level` processor provides it.

## `dd.*` Fields Are for APM Tracing ONLY

**Important**: The `dd.env`, `dd.service`, `dd.version` fields are reserved for APM tracing correlation.

**Do NOT use these fields unless APM tracing is enabled in your application.**

For plain log management (without APM), use standard attributes directly:

| APM Tracing Field | Plain Log Management Field |
|-------------------|----------------------------|
| `dd.env` | `env` |
| `dd.service` | `service` |
| `dd.version` | `version` |

Our configuration uses `env` and `service` (not `dd.env` and `dd.service`) because most services use log management without APM tracing.

## Correct Output Format

### Our Structlog Configuration Outputs:
```json
{
  "timestamp": "2025-01-15T10:30:00.123Z",
  "message": "User logged in",
  "level": "info",
  "logger": "app.services.user",
  "service": "user-service",
  "env": "production",
  "user_id": 123,
  "ip_address": "192.168.1.1"
}
```

**Key fields:**
- `message`: The log body (Datadog reserved attribute)
- `level`: Severity level (Datadog auto-maps to `status`)
- `service`: Service name
- `env`: Environment (NOT `dd.env`)

## Standard Datadog Fields

Our configuration automatically includes these Datadog-recognized fields:

### `timestamp`
- **Format**: ISO 8601 with milliseconds and UTC timezone
- **Example**: `"2025-01-15T10:30:00.123Z"`
- **Datadog Use**: Used for log chronology and time-based queries

### `service`
- **Source**: Set via `configure_logging(service_name="...")` or `SERVICE_NAME` env var
- **Example**: `"service": "user-api"`
- **Datadog Use**: Populates the Service facet, used for service-level dashboards

### `env`
- **Source**: Set via `configure_logging(environment="...")` or `ENVIRONMENT` env var
- **Example**: `"env": "production"`
- **Datadog Use**: Populates the Env facet, used for environment-based filtering
- **Note**: We use `env` (not `dd.env`) because `dd.env` is reserved for APM tracing

### `level`
- **Source**: Added by `structlog.stdlib.add_log_level` processor
- **Values**: `"debug"`, `"info"`, `"warning"`, `"error"`, `"critical"`
- **Datadog Use**: Auto-mapped to `status` for severity filtering and color coding

## Custom Structured Fields

Any additional fields you log become searchable attributes in Datadog:

```python
logger.info(
    "payment_processed",
    user_id=123,
    amount=99.99,
    currency="USD",
    payment_method="credit_card"
)
```

Results in Datadog:
```json
{
  "level": "info",
  "message": "payment_processed",
  "timestamp": "2025-01-15T10:30:00.123Z",
  "service": "payment-service",
  "env": "production",
  "user_id": 123,
  "amount": 99.99,
  "currency": "USD",
  "payment_method": "credit_card"
}
```

Each field becomes a facet in Datadog that you can:
- Filter by: `@user_id:123`
- Aggregate on: Count by `@payment_method`
- Create monitors from: Alert when `@amount > 10000`

## Context Propagation

When you bind context, it appears in all subsequent logs:

```python
log = logger.bind(request_id="abc-123", user_id=456)
log.info("request_started")
log.info("database_query", table="users", query_time_ms=45)
log.info("request_completed", status_code=200)
```

All three logs will have:
```json
{
  "request_id": "abc-123",
  "user_id": 456,
  ...
}
```

### Benefits in Datadog:
1. **Trace correlation**: Filter all logs by `@request_id:abc-123`
2. **User journey tracking**: See all actions by `@user_id:456`
3. **Cross-service tracing**: Same request_id across microservices

## Exception Handling

When using `logger.exception()`, the configuration automatically includes:

```python
try:
    risky_operation()
except ValueError as e:
    logger.exception("operation_failed", operation="risky_operation")
```

Output:
```json
{
  "level": "error",
  "message": "operation_failed",
  "operation": "risky_operation",
  "exception": "Traceback (most recent call last):\n  File ...",
  "timestamp": "2025-01-15T10:30:00.123Z"
}
```

The `exception` field contains the full traceback, which Datadog parses and displays nicely in the UI.

## Datadog Agent Configuration

### No Changes Needed!

The Datadog agent running on your Kubernetes nodes automatically:
1. Collects stdout/stderr from containers
2. Detects JSON format
3. Parses the JSON fields
4. Maps `level` to `status` for severity filtering

### Verification

After deploying your service, verify in Datadog:

1. **Check Level/Status Field**:
   ```
   @status:info
   @status:error
   ```
   Should show logs categorized by severity with proper color coding.

2. **Check Service Tag**:
   ```
   service:my-service
   ```
   Should show all logs from your service.

3. **Check Custom Fields**:
   ```
   @user_id:123
   @request_id:abc-123
   ```
   All your custom fields should be searchable.

## Common Patterns

### Web Request Tracing
```python
# Middleware or request handler
log = logger.bind(
    request_id=request.headers.get("X-Request-ID"),
    method=request.method,
    path=request.url.path,
    user_id=current_user.id
)
log.info("request_started")
# ... handle request ...
log.info("request_completed", status_code=response.status_code, duration_ms=123)
```

Datadog query:
```
service:my-service @request_id:abc-123
```
Shows entire request lifecycle.

### Error Monitoring with Context
```python
logger.error(
    "database_error",
    error_type="connection_timeout",
    db_host="postgres-primary",
    retry_count=3,
    user_id=user_id
)
```

Datadog monitor:
```
service:my-service @status:error @error_type:connection_timeout
```
Alert when database connection errors exceed threshold.

### Background Job Tracking
```python
log = logger.bind(
    job_id=job.id,
    job_type="data_export",
    user_id=job.user_id
)
log.info("job_started")
log.info("job_progress", records_processed=1000, total_records=5000)
log.info("job_completed", duration_seconds=45)
```

Datadog query:
```
service:worker-service @job_id:12345
```
Track entire job execution.

## Migration Impact

### Before (python-json-logger)
```json
{
  "asctime": "2025-01-15 10:30:00,123",
  "name": "app.services.user",
  "levelname": "INFO",
  "message": "User logged in",
  "pathname": "/app/services/user.py",
  "lineno": 42,
  "funcName": "login"
}
```

Datadog issues:
- `levelname` is just a custom field, not recognized as severity
- No `service` tag for service-level filtering
- Timestamp format not ideal
- No structured fields

### After (structlog with our configuration)
```json
{
  "message": "User logged in",
  "level": "info",
  "timestamp": "2025-01-15T10:30:00.123Z",
  "logger": "app.services.user",
  "service": "user-service",
  "env": "production",
  "user_id": 123,
  "ip_address": "192.168.1.1"
}
```

Datadog benefits:
- `message` properly recognized as log body
- `level` auto-mapped to `status` for severity filtering
- `service` tag for service filtering
- `env` for environment-based filtering (not `dd.env` which is APM-only)
- ISO 8601 timestamp with milliseconds
- All custom fields are searchable facets

## Additional Resources

- [Datadog Log Attributes Naming Convention](https://docs.datadoghq.com/logs/log_configuration/attributes_naming_convention/)
- [Datadog Reserved Attributes](https://docs.datadoghq.com/logs/log_configuration/attributes_naming_convention/#reserved-attributes)
- [Structlog Processors](https://www.structlog.org/en/stable/processors.html)
- [Datadog Python Log Collection](https://docs.datadoghq.com/logs/log_collection/python/)
