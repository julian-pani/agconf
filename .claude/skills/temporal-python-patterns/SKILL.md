---
name: temporal-python-patterns
description: Best practices for writing maintainable Temporal workflows in Python. Use when implementing Temporal workflows, activities, or dealing with workflow history size issues.
license: Apache-2.0
metadata:
  author: platform-engineering
  version: 1.0
  tags: temporal, python, workflow, distributed-systems
  policy: recommended
  scope: organization
---

# Temporal Python Patterns

Best practices for writing maintainable and efficient Temporal workflows in Python.

## When to Use This Skill

- Implementing new Temporal workflows in Python
- Debugging workflow history size issues
- Encountering mypy type checking errors with activities
- Refactoring existing Temporal workflows
- Processing large datasets with Temporal

## Core Principles

### 1. Keep Workflow History Small

**Problem**: Temporal workflows persist their entire execution history. Large payloads in workflow parameters or return values can cause:
- Slow workflow replays
- Increased storage costs
- Workflow execution failures when history exceeds limits

**Solution**: Pass large data through activities, return only summaries to workflows.

#### Before (Bad - Large Data in Workflow)

```python
from temporalio import workflow
from dataclasses import dataclass

@dataclass
class ProcessRequest:
    user_id: str
    items: list[dict]  # Could be thousands of items

@dataclass
class ProcessResult:
    processed_items: list[dict]  # Full processed data in history
    total: int

@workflow.defn
class ProcessWorkflow:
    @workflow.run
    async def run(self, request: ProcessRequest) -> ProcessResult:
        # BAD: Processing large data directly in workflow
        processed = []
        for item in request.items:
            result = await workflow.execute_activity(
                process_single_item,
                item,
                start_to_close_timeout=timedelta(seconds=30)
            )
            processed.append(result)

        # BAD: Returning all processed data bloats workflow history
        return ProcessResult(
            processed_items=processed,
            total=len(processed)
        )
```

**Issues**:
- `request.items` could be massive (stored in workflow history)
- `processed_items` duplicates data in history
- Every workflow replay loads this data into memory

#### After (Good - Minimal Workflow History)

```python
from temporalio import workflow
from dataclasses import dataclass

@dataclass
class ProcessRequest:
    user_id: str
    data_location: str  # S3 path, database ID, etc.

@dataclass
class ProcessResult:
    result_location: str  # Where to find results
    total_processed: int
    failed_count: int

@workflow.defn
class ProcessWorkflow:
    @workflow.run
    async def run(self, request: ProcessRequest) -> ProcessResult:
        # GOOD: Activity handles large data
        result = await workflow.execute_activity(
            process_all_items,
            args=[request.data_location],
            start_to_close_timeout=timedelta(minutes=5)
        )

        # GOOD: Workflow stores only summary metadata
        return ProcessResult(
            result_location=result.output_path,
            total_processed=result.count,
            failed_count=result.errors
        )

@activity.defn
async def process_all_items(data_location: str) -> ActivityResult:
    # Activity loads large data from external storage
    items = load_from_storage(data_location)

    # Process all items
    processed = [process_item(item) for item in items]

    # Store results externally
    output_path = save_to_storage(processed)

    # Return only metadata to workflow
    return ActivityResult(
        output_path=output_path,
        count=len(processed),
        errors=count_errors(processed)
    )
```

**Benefits**:
- Workflow history contains only metadata (KB instead of MB)
- Activities can handle arbitrarily large data
- Workflow replays are fast and memory-efficient
- External storage (S3, database) holds actual data

### 2. Use Batch Child Workflows for Large Datasets

**Problem**: Processing thousands or millions of records in a single workflow creates a massive history and makes it hard to track progress.

**Solution**: Use a parent-child workflow pattern where the parent coordinates batches and child workflows process each batch independently.

**When to use this pattern**:
- Processing large datasets (thousands+ records)
- Need to track progress across multiple batches
- Want to resume from last successful batch if interrupted
- Want clear visibility in Temporal UI of which batches succeeded/failed

**Why NOT to use Continue-As-New**:
- Harder to visualize the dependency graph in Temporal UI
- More difficult to track overall progress
- Loses visibility into individual batch execution details
- Child workflows provide better observability

#### Pattern: Parent Coordinates, Children Execute

```python
from temporalio import workflow
from pydantic import BaseModel

class BatchParams(BaseModel):
    """Parameters for a single batch child workflow"""
    run_key: str
    batch_size: int
    activity_batch_size: int

class BatchResult(BaseModel):
    """Result from a single batch child workflow"""
    num_to_process: int
    num_successful: int
    num_failed: int
    no_more_batches: bool = False

@workflow.defn
class ProcessBatchWf:
    """Child workflow that processes a single batch"""

    @workflow.run
    async def run(self, params: BatchParams) -> BatchResult:
        # Load IDs for this batch from database
        entity_ids = await workflow.execute_activity(
            load_batch,
            args=[params.run_key, params.batch_size],
            start_to_close_timeout=timedelta(seconds=60)
        )

        # If no more records, signal completion
        if not entity_ids:
            return BatchResult(
                num_to_process=0,
                num_successful=0,
                num_failed=0,
                no_more_batches=True
            )

        # Process the batch in smaller activity chunks
        total_successful = 0
        total_failed = 0

        for i in range(0, len(entity_ids), params.activity_batch_size):
            chunk = entity_ids[i:i + params.activity_batch_size]

            result = await workflow.execute_activity(
                process_chunk,
                args=[chunk],
                start_to_close_timeout=timedelta(hours=1)
            )
            total_successful += result.num_successful
            total_failed += result.num_failed

        return BatchResult(
            num_to_process=len(entity_ids),
            num_successful=total_successful,
            num_failed=total_failed
        )

class ParentParams(BaseModel):
    """Parameters for parent workflow"""
    run_key: str
    batch_size: int = 1000
    activity_batch_size: int = 100

class ParentResult(BaseModel):
    """Final result from parent workflow"""
    total_processed: int
    num_successful: int
    num_failed: int

@workflow.defn
class ProcessAllDataWorkflow:
    """Parent workflow that coordinates batch processing"""

    @workflow.run
    async def run(self, params: ParentParams) -> ParentResult:
        total_successful = 0
        total_failed = 0
        batch_idx = 0

        # Keep launching child workflows until no more batches
        while True:
            workflow.logger.info(f"Starting batch {batch_idx}")

            # Launch child workflow for this batch
            batch_result = await workflow.execute_child_workflow(
                ProcessBatchWf.run,
                args=[BatchParams(
                    run_key=params.run_key,
                    batch_size=params.batch_size,
                    activity_batch_size=params.activity_batch_size
                )],
                id=f"{workflow.info().workflow_id}_batch_{batch_idx}",
                execution_timeout=timedelta(hours=2)
            )

            # Check if we're done
            if batch_result.no_more_batches:
                workflow.logger.info(f"Completed all batches")
                break

            # Update totals
            total_successful += batch_result.num_successful
            total_failed += batch_result.num_failed

            batch_idx += 1

        return ParentResult(
            total_processed=total_successful + total_failed,
            num_successful=total_successful,
            num_failed=total_failed
        )
```

**Key aspects of this pattern**:

1. **Child workflow ID**: Use deterministic IDs like `{parent_id}_batch_{index}` for idempotency
2. **No data in workflow history**: Load entity IDs in activity, not in workflow parameters
3. **Metadata only**: Child workflows return counts/summaries, not full datasets
4. **Resumable**: If parent crashes, it can resume from last completed batch
5. **Visible in UI**: Each batch shows as separate workflow execution

**Loading data within activities**:
```python
@activity.defn
async def load_batch(run_key: str, batch_size: int) -> list[str]:
    """Load next batch of IDs from database"""
    # Query database for next batch of PENDING entities
    # Return only IDs, not full records
    return db.query(
        "SELECT id FROM entities WHERE run_key = ? AND status = 'PENDING' LIMIT ?",
        run_key, batch_size
    )
```

**Benefits of batch child workflow pattern**:
- Parent workflow history stays tiny (only batch summaries)
- Clear visibility: see each batch in Temporal UI
- Easy to monitor: which batches succeeded, which failed
- Resumable: restart from last successful batch
- Scalable: can process millions of records

### 3. Use Pydantic Models for Workflow Parameters

**Policy**: Workflow parameters (for methods decorated with `@workflow.run`) should always be Pydantic models, even for single parameters.

**Why**: Temporal strongly recommends this pattern for:
- Schema evolution (adding fields without breaking existing workflows)
- Type safety and validation
- Clear documentation of workflow inputs
- Avoiding positional argument confusion

**Reference**: [Temporal Python Workflow Parameters](https://docs.temporal.io/develop/python/core-application#workflow-parameters)

#### Before (Bad - Primitive Parameters)

```python
from temporalio import workflow

@workflow.defn
class SendEmailWorkflow:
    @workflow.run
    async def run(self, user_id: str, email: str, template: str) -> bool:
        # BAD: Positional args are fragile
        # Adding new parameter breaks all running workflows
        ...
```

**Issues**:
- Can't add optional parameters without breaking workflows
- No validation of inputs
- Unclear what each parameter represents

#### After (Good - Pydantic Model)

```python
from temporalio import workflow
from pydantic import BaseModel, EmailStr

class SendEmailRequest(BaseModel):
    user_id: str
    email: EmailStr  # Built-in validation
    template: str
    # Easy to add new optional fields later
    priority: str = "normal"

@workflow.defn
class SendEmailWorkflow:
    @workflow.run
    async def run(self, request: SendEmailRequest) -> bool:
        # GOOD: Clear, validated input
        # Can add fields to SendEmailRequest without breaking existing workflows
        ...
```

**Benefits**:
- Built-in validation with Pydantic
- Easy to add optional fields later
- Self-documenting code
- Compatible with schema evolution

### 4. Type-Safe Activity Execution with Mypy

**Problem**: Mypy type checking fails on activity execution because `execute_activity` accepts generic arguments.

#### Before (Bad - Type Errors)

```python
from temporalio import workflow

@workflow.defn
class MyWorkflow:
    @workflow.run
    async def run(self, request: Request) -> Result:
        # Mypy error: Cannot infer type of activity arguments
        result = await workflow.execute_activity(
            process_data,
            request.data_id,  # Mypy can't validate this matches activity signature
            start_to_close_timeout=timedelta(seconds=30)
        )
```

**Mypy Error**:
```
error: Need type annotation for "result"
error: Argument type cannot be determined
```

#### After (Good - Explicit args=[])

```python
from temporalio import workflow

@workflow.defn
class MyWorkflow:
    @workflow.run
    async def run(self, request: Request) -> Result:
        # GOOD: Use args=[] pattern for type safety
        result = await workflow.execute_activity(
            process_data,
            args=[request.data_id],  # Explicit list makes mypy happy
            start_to_close_timeout=timedelta(seconds=30)
        )
```

**Why this works**:
- `args=[]` provides explicit type context
- Mypy can validate arguments match activity signature
- Type checker can infer return type from activity definition

**Pattern for Multiple Arguments**:

```python
# Activity with multiple parameters
@activity.defn
async def process_with_config(data_id: str, config: Config, retries: int) -> ProcessResult:
    ...

# Type-safe invocation
result = await workflow.execute_activity(
    process_with_config,
    args=[request.data_id, request.config, 3],  # All args in list
    start_to_close_timeout=timedelta(seconds=30)
)
```

## Quick Reference Checklist

When implementing Temporal workflows:

1. **Workflow Parameters**
   - [ ] Use Pydantic model (not primitives)
   - [ ] Include only small, essential data
   - [ ] Use external references (paths, IDs) for large data

2. **Workflow Return Values**
   - [ ] Return summaries, not full datasets
   - [ ] Include locations/references to results
   - [ ] Keep under 1KB when possible

3. **Activities**
   - [ ] Handle all large data processing
   - [ ] Load from/save to external storage
   - [ ] Return metadata to workflow

4. **Type Safety**
   - [ ] Use `args=[]` pattern for activity execution
   - [ ] Ensure mypy passes without errors
   - [ ] Define explicit types for all workflow/activity parameters

5. **Large Datasets**
   - [ ] Use batch child workflows (not Continue-As-New)
   - [ ] Load data in activities, not workflow parameters
   - [ ] Use deterministic child workflow IDs
   - [ ] Return only summaries from child workflows

## Common Pitfalls

**Don't pass large data to workflows**:
```python
# BAD
@workflow.run
async def run(self, data: ProcessRequest) -> ProcessResult:
    # request.items has 10,000 records -> bloats history
```

**Don't return large data from workflows**:
```python
# BAD
return ProcessResult(all_records=processed_items)  # Stores everything in history
```

**Don't use positional args without args=[]**:
```python
# BAD - Mypy errors
result = await workflow.execute_activity(process, data_id, config)

# GOOD
result = await workflow.execute_activity(process, args=[data_id, config])
```

**Don't use Continue-As-New for batch processing**:
```python
# BAD - Hard to track progress, poor UI visibility
await workflow.continue_as_new(args=[next_batch])

# GOOD - Use child workflows instead
await workflow.execute_child_workflow(ProcessBatchWf.run, args=[batch_params])
```

## Summary

**Four key patterns**:
1. **Keep workflow history small** - Use activities for large data, return only summaries
2. **Use batch child workflows** - For large datasets, prefer child workflows over Continue-As-New
3. **Always use Pydantic models** - Even for single workflow parameters
4. **Type-safe activities** - Use `args=[]` pattern for mypy compatibility

Following these patterns ensures workflows are maintainable, performant, type-safe, and observable in the Temporal UI.
