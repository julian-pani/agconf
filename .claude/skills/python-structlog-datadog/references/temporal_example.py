"""
Temporal workflow example with structlog + Datadog logging.

This example demonstrates:
- Workflow-level context binding (workflow_id, run_id)
- Activity-level context binding
- Error handling and retries with structured logging
- Long-running workflow progress tracking
- Child workflow logging

Run Temporal worker with:
    ENVIRONMENT=production python temporal_example.py
"""

import asyncio
import os
from datetime import timedelta
from typing import Any

import structlog
from temporalio import activity, workflow
from temporalio.client import Client
from temporalio.worker import Worker

# Import your logging configuration
from logging_config import configure_logging

# Configure logging at module load
configure_logging(
    service_name=os.environ.get("SERVICE_NAME", "temporal-worker"),
    environment=os.environ.get("ENVIRONMENT", "development"),
)

# Get base logger
base_logger = structlog.get_logger()


# ============================================================================
# Activities
# ============================================================================

@activity.defn(name="fetch_user_data")
async def fetch_user_data(user_id: int) -> dict[str, Any]:
    """
    Activity to fetch user data.
    
    Demonstrates:
    - Activity-level context binding
    - Error handling with retries
    - Progress logging
    """
    # Bind activity context
    log = base_logger.bind(
        activity="fetch_user_data",
        user_id=user_id,
        attempt=activity.info().attempt,
    )
    
    log.info("activity_started")
    
    try:
        # Simulate API call
        await asyncio.sleep(0.5)
        
        # Simulate occasional failures for retry demonstration
        if activity.info().attempt < 2:
            log.warning("simulated_failure", will_retry=True)
            raise Exception("Simulated transient error")
        
        user_data = {
            "user_id": user_id,
            "name": f"User {user_id}",
            "email": f"user{user_id}@example.com",
        }
        
        log.info("activity_completed", user_name=user_data["name"])
        return user_data
        
    except Exception:
        log.exception("activity_failed")
        raise


@activity.defn(name="send_notification")
async def send_notification(user_id: int, notification_type: str, message: str) -> bool:
    """
    Activity to send notifications.
    
    Demonstrates:
    - Multiple context fields
    - Success/failure logging
    """
    log = base_logger.bind(
        activity="send_notification",
        user_id=user_id,
        notification_type=notification_type,
        attempt=activity.info().attempt,
    )
    
    log.info("activity_started", message_length=len(message))
    
    try:
        # Simulate notification sending
        await asyncio.sleep(0.3)
        
        log.info(
            "notification_sent",
            success=True,
            channel=notification_type,
        )
        return True
        
    except Exception:
        log.exception("notification_failed")
        return False


@activity.defn(name="process_payment")
async def process_payment(user_id: int, amount: float, currency: str) -> dict[str, Any]:
    """
    Activity to process payment.
    
    Demonstrates:
    - Financial transaction logging
    - Detailed success/failure information
    """
    log = base_logger.bind(
        activity="process_payment",
        user_id=user_id,
        amount=amount,
        currency=currency,
        attempt=activity.info().attempt,
    )
    
    log.info("activity_started")
    
    try:
        # Simulate payment processing
        await asyncio.sleep(1.0)
        
        payment_result = {
            "transaction_id": f"txn_{user_id}_{int(amount * 100)}",
            "status": "completed",
            "amount": amount,
            "currency": currency,
        }
        
        log.info(
            "payment_processed",
            transaction_id=payment_result["transaction_id"],
            status=payment_result["status"],
        )
        
        return payment_result
        
    except Exception:
        log.exception("payment_failed")
        raise


# ============================================================================
# Workflows
# ============================================================================

@workflow.defn(name="UserOnboardingWorkflow")
class UserOnboardingWorkflow:
    """
    Main workflow for user onboarding.
    
    Demonstrates:
    - Workflow-level context binding
    - Activity execution with logging
    - Error handling and compensation
    - Progress tracking
    """
    
    def __init__(self):
        # Workflow state
        self.progress = 0
        self.steps_completed = []
    
    @workflow.run
    async def run(self, user_id: int) -> dict[str, Any]:
        """
        Main workflow execution.
        """
        # Bind workflow context
        log = base_logger.bind(
            workflow="UserOnboardingWorkflow",
            workflow_id=workflow.info().workflow_id,
            run_id=workflow.info().run_id,
            user_id=user_id,
        )
        
        log.info("workflow_started")
        
        try:
            # Step 1: Fetch user data
            log.info("workflow_step_started", step="fetch_user_data", progress=0)
            user_data = await workflow.execute_activity(
                fetch_user_data,
                user_id,
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy={
                    "initial_interval": timedelta(seconds=1),
                    "maximum_attempts": 3,
                },
            )
            self.steps_completed.append("fetch_user_data")
            self.progress = 33
            log.info("workflow_step_completed", step="fetch_user_data", progress=33)
            
            # Step 2: Send welcome notification
            log.info("workflow_step_started", step="send_notification", progress=33)
            notification_sent = await workflow.execute_activity(
                send_notification,
                args=[user_id, "email", f"Welcome {user_data['name']}!"],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy={
                    "initial_interval": timedelta(seconds=1),
                    "maximum_attempts": 3,
                },
            )
            self.steps_completed.append("send_notification")
            self.progress = 66
            log.info(
                "workflow_step_completed",
                step="send_notification",
                progress=66,
                notification_sent=notification_sent,
            )
            
            # Step 3: Process initial payment (if applicable)
            log.info("workflow_step_started", step="process_payment", progress=66)
            payment_result = await workflow.execute_activity(
                process_payment,
                args=[user_id, 29.99, "USD"],
                start_to_close_timeout=timedelta(seconds=60),
                retry_policy={
                    "initial_interval": timedelta(seconds=2),
                    "maximum_attempts": 5,
                },
            )
            self.steps_completed.append("process_payment")
            self.progress = 100
            log.info(
                "workflow_step_completed",
                step="process_payment",
                progress=100,
                transaction_id=payment_result["transaction_id"],
            )
            
            # Workflow completed successfully
            result = {
                "user_id": user_id,
                "user_data": user_data,
                "payment": payment_result,
                "notification_sent": notification_sent,
                "steps_completed": self.steps_completed,
            }
            
            log.info(
                "workflow_completed",
                success=True,
                steps_count=len(self.steps_completed),
            )
            
            return result
            
        except Exception as e:
            # Workflow failed
            log.exception(
                "workflow_failed",
                error_type=type(e).__name__,
                steps_completed=self.steps_completed,
                progress=self.progress,
            )
            
            # Could implement compensation logic here
            log.info("compensation_started", steps_to_compensate=self.steps_completed)
            
            raise


@workflow.defn(name="DataProcessingWorkflow")
class DataProcessingWorkflow:
    """
    Example of a long-running data processing workflow.
    
    Demonstrates:
    - Batch processing with progress logging
    - Heartbeat-style progress updates
    """
    
    @workflow.run
    async def run(self, batch_id: str, record_count: int) -> dict[str, Any]:
        """
        Process a batch of records.
        """
        log = base_logger.bind(
            workflow="DataProcessingWorkflow",
            workflow_id=workflow.info().workflow_id,
            batch_id=batch_id,
            total_records=record_count,
        )
        
        log.info("workflow_started")
        
        processed_count = 0
        failed_count = 0
        
        try:
            # Process in chunks
            chunk_size = 100
            for i in range(0, record_count, chunk_size):
                chunk_end = min(i + chunk_size, record_count)
                chunk_log = log.bind(
                    chunk_start=i,
                    chunk_end=chunk_end,
                )
                
                chunk_log.info("processing_chunk")
                
                # Simulate processing
                await asyncio.sleep(0.1)
                
                # Update progress
                processed_count = chunk_end
                progress_pct = (processed_count / record_count) * 100
                
                chunk_log.info(
                    "chunk_processed",
                    processed_count=processed_count,
                    progress_pct=round(progress_pct, 1),
                )
            
            log.info(
                "workflow_completed",
                processed_count=processed_count,
                failed_count=failed_count,
            )
            
            return {
                "batch_id": batch_id,
                "total_records": record_count,
                "processed_count": processed_count,
                "failed_count": failed_count,
            }
            
        except Exception:
            log.exception(
                "workflow_failed",
                processed_count=processed_count,
                failed_count=failed_count,
            )
            raise


# ============================================================================
# Worker Setup
# ============================================================================

async def main():
    """
    Start the Temporal worker.
    """
    log = base_logger.bind(component="temporal_worker")
    log.info("worker_starting")
    
    # Connect to Temporal server
    client = await Client.connect("localhost:7233")
    log.info("connected_to_temporal", server="localhost:7233")
    
    # Create worker
    worker = Worker(
        client,
        task_queue="user-onboarding-queue",
        workflows=[UserOnboardingWorkflow, DataProcessingWorkflow],
        activities=[fetch_user_data, send_notification, process_payment],
    )
    
    log.info(
        "worker_configured",
        task_queue="user-onboarding-queue",
        workflows=["UserOnboardingWorkflow", "DataProcessingWorkflow"],
        activities=["fetch_user_data", "send_notification", "process_payment"],
    )
    
    # Run worker
    try:
        log.info("worker_started")
        await worker.run()
    except Exception:
        log.exception("worker_failed")
        raise
    finally:
        log.info("worker_stopped")


if __name__ == "__main__":
    asyncio.run(main())


# ============================================================================
# Example: Starting a workflow
# ============================================================================

async def start_onboarding_workflow_example():
    """
    Example of how to start the workflow from another service.
    """
    log = base_logger.bind(component="workflow_client")
    
    # Connect to Temporal
    client = await Client.connect("localhost:7233")
    
    user_id = 12345
    workflow_id = f"user-onboarding-{user_id}"
    
    log.info(
        "starting_workflow",
        workflow="UserOnboardingWorkflow",
        workflow_id=workflow_id,
        user_id=user_id,
    )
    
    try:
        # Start workflow
        handle = await client.start_workflow(
            UserOnboardingWorkflow.run,
            user_id,
            id=workflow_id,
            task_queue="user-onboarding-queue",
        )
        
        log.info(
            "workflow_started",
            workflow_id=workflow_id,
            run_id=handle.first_execution_run_id,
        )
        
        # Wait for result (optional)
        result = await handle.result()
        
        log.info(
            "workflow_result_received",
            workflow_id=workflow_id,
            success=True,
            steps_completed=result["steps_completed"],
        )
        
        return result
        
    except Exception:
        log.exception(
            "workflow_start_failed",
            workflow_id=workflow_id,
            user_id=user_id,
        )
        raise


# How to run this example:
# 
# 1. Start Temporal server (e.g., with docker-compose)
# 2. Run the worker:
#    ENVIRONMENT=production python temporal_example.py
# 
# 3. In another terminal, start a workflow:
#    python -c "import asyncio; from temporal_example import start_onboarding_workflow_example; asyncio.run(start_onboarding_workflow_example())"
# 
# All logs will be structured and include workflow/activity context!
