"""
Structlog configuration for Python services with Datadog integration.

This module provides production-ready structured logging that works seamlessly
with Datadog's log management. It handles:
- Automatic log level mapping (Datadog auto-maps 'level' to 'status')
- ISO 8601 timestamp formatting
- Service name and environment tagging
- Context propagation (request_id, user_id, etc.)
- Pretty console output for development
- JSON output for production

Key Datadog reserved attributes used:
- `message`: The log body (Datadog's reserved attribute for log content)
- `level`: Severity level (Datadog auto-maps this to `status`)
- `service`: Service name
- `env`: Environment (NOT `dd.env` - that's for APM tracing only)

Reference: https://docs.datadoghq.com/logs/log_configuration/attributes_naming_convention/

Usage:
    from app.logging_config import configure_logging
    import structlog

    # Call once at application startup
    configure_logging(
        service_name="my-service",
        environment="production"  # or "development"
    )

    # Get logger and use it
    logger = structlog.get_logger(__name__)
    logger.info("user_logged_in", user_id=123, email="user@example.com")
"""

import logging
import os
import sys
from typing import Any, Dict

import structlog


def rename_event_to_message(
    logger: logging.Logger, method_name: str, event_dict: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Rename structlog's 'event' key to Datadog's reserved 'message' attribute.

    Datadog uses 'message' as the reserved attribute for the log body.
    Structlog uses 'event' by default. This processor renames it for Datadog compatibility.

    Reference: https://docs.datadoghq.com/logs/log_configuration/attributes_naming_convention/
    """
    if "event" in event_dict:
        event_dict["message"] = event_dict.pop("event")
    return event_dict


def add_service_context(
    logger: logging.Logger, method_name: str, event_dict: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Add service name and environment to every log record.

    Note: We use 'env' (not 'dd.env') because:
    - 'dd.env', 'dd.service', 'dd.version' are reserved for APM tracing correlation
    - For plain log management without APM, use standard attributes: 'env', 'service', 'version'

    Reference: https://docs.datadoghq.com/logs/log_configuration/attributes_naming_convention/
    """
    # These will be set during configure_logging()
    if hasattr(configure_logging, "_service_name"):
        event_dict["service"] = configure_logging._service_name

    if hasattr(configure_logging, "_environment"):
        event_dict["env"] = configure_logging._environment

    return event_dict


def configure_logging(
    service_name: str | None = None,
    environment: str | None = None,
    log_level: str = "INFO",
) -> None:
    """
    Configure structlog with Datadog-compatible output.

    Args:
        service_name: Name of the service (e.g., "user-api", "payment-service")
                     Falls back to SERVICE_NAME env var or "unknown-service"
        environment: Environment name (e.g., "production", "staging", "development")
                    Falls back to ENVIRONMENT env var or "development"
        log_level: Minimum log level (default: INFO)

    Call this once at application startup, before any logging.

    IMPORTANT: This configuration uses structlog.stdlib.LoggerFactory() which means:
    - Structlog processors should NOT end with a renderer
    - Instead, end with wrap_for_formatter and let ProcessorFormatter do the rendering
    - This prevents double-rendering issues
    """
    # Set service name and environment
    configure_logging._service_name = (
        service_name
        or os.environ.get("SERVICE_NAME")
        or "unknown-service"
    )
    configure_logging._environment = (
        environment
        or os.environ.get("ENVIRONMENT")
        or "development"
    )

    # Determine if we're in development mode
    is_dev = configure_logging._environment.lower() in ["dev", "development", "local"]

    # Shared processors for both structlog and stdlib logs
    # These run BEFORE the final rendering
    shared_processors = [
        # Add log level to event dict
        structlog.stdlib.add_log_level,
        # Add logger name (module name) - IMPORTANT for debugging!
        structlog.stdlib.add_logger_name,
        # Add timestamp
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        # Add service context (service name, environment)
        add_service_context,
        # If an exception is logged, format it properly
        structlog.processors.format_exc_info,
        # Rename 'event' to 'message' for Datadog compatibility
        rename_event_to_message,
    ]

    # Choose renderer based on environment
    if is_dev:
        renderer = structlog.dev.ConsoleRenderer(colors=True)
    else:
        renderer = structlog.processors.JSONRenderer()

    # Structlog processors - when using stdlib LoggerFactory, processors should
    # NOT end with a renderer. Instead, end with wrap_for_formatter and let
    # the ProcessorFormatter do the final rendering.
    structlog_processors = shared_processors + [
        # This MUST be the last processor when using LoggerFactory
        # It prepares the event dict for the stdlib ProcessorFormatter
        structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
    ]

    # Configure structlog
    structlog.configure(
        processors=structlog_processors,
        # Use standard library logging as the final output
        logger_factory=structlog.stdlib.LoggerFactory(),
        # Cache the logger for performance
        cache_logger_on_first_use=True,
    )

    # ProcessorFormatter for standard library logs (uvicorn, third-party, etc.)
    # This is where the actual rendering happens
    formatter = structlog.stdlib.ProcessorFormatter(
        # The final renderer (JSON for prod, Console for dev)
        processor=renderer,
        # Processors to run on logs from standard library loggers
        # (logs that didn't originate from structlog)
        foreign_pre_chain=shared_processors,
    )

    # Configure standard library logging to route through structlog
    # IMPORTANT: Clear existing handlers first to prevent duplicate output
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)
    root_logger = logging.getLogger()
    root_logger.handlers.clear()  # Clear existing handlers to prevent duplicates
    root_logger.addHandler(handler)
    root_logger.setLevel(getattr(logging, log_level.upper()))

    # Clear uvicorn's default handlers so logs propagate to root and get formatted
    # Uvicorn adds its own handlers which would bypass our formatting
    logging.getLogger("uvicorn").handlers = []
    logging.getLogger("uvicorn.access").handlers = []
    logging.getLogger("uvicorn.error").handlers = []

    # Silence overly verbose third-party loggers if needed
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("asyncio").setLevel(logging.WARNING)


# For backward compatibility with standard logging
def get_logger(name: str | None = None) -> structlog.BoundLogger:
    """
    Get a structlog logger (equivalent to structlog.get_logger(__name__)).

    This function exists for backward compatibility with code that uses:
        from logging_config import get_logger
        logger = get_logger(__name__)

    Args:
        name: Logger name (typically __name__). Passed through to structlog
              to capture the module name for debugging.

    Returns:
        A structlog BoundLogger instance
    """
    return structlog.get_logger(name)


if __name__ == "__main__":
    # Demo script showing development vs production output
    print("=== Development Mode ===")
    configure_logging(
        service_name="demo-service",
        environment="development",
        log_level="DEBUG"
    )

    logger = structlog.get_logger(__name__)
    logger.debug("debug_message", extra_field="debug_value")
    logger.info("user_action", user_id=123, action="login")
    logger.warning("rate_limit_approaching", requests=95, limit=100)
    logger.error("operation_failed", operation="payment", error_code="INSUFFICIENT_FUNDS")

    try:
        1 / 0
    except Exception:
        logger.exception("exception_occurred", context="demo")

    # Demonstrate context binding
    log_with_context = logger.bind(request_id="abc-123", user_id=456)
    log_with_context.info("request_started")
    log_with_context.info("processing_data")
    log_with_context.info("request_completed")

    print("\n=== Production Mode ===")
    # Need to reset structlog configuration for the second demo
    structlog.reset_defaults()

    configure_logging(
        service_name="demo-service",
        environment="production",
        log_level="INFO"
    )

    logger = structlog.get_logger(__name__)
    logger.debug("debug_message_hidden")  # Won't appear (below INFO level)
    logger.info("user_action", user_id=123, action="login")
    logger.error("operation_failed", operation="payment", error_code="INSUFFICIENT_FUNDS")

    log_with_context = logger.bind(request_id="xyz-789", user_id=999)
    log_with_context.info("request_started")
    log_with_context.info("request_completed", duration_ms=250)
