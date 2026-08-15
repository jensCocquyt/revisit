# job-processing Specification (delta)

## MODIFIED Requirements

### Requirement: Structured processing logs
The worker SHALL log job lifecycle events (claim, completion, failure, reschedule) as single-line JSON including `link_id` and `job_id`. Failure and reschedule events SHALL additionally include the attempt number just recorded and the stable error code (the prefix of `last_error` before its first `:`), so failures are countable and groupable from logs alone.

#### Scenario: Lifecycle events are attributable
- **WHEN** a job is claimed and completed
- **THEN** the worker emits single-line JSON log entries for each event containing that job's `job_id` and `link_id`

#### Scenario: Failure events are countable
- **WHEN** a job attempt fails, whether rescheduled or terminal
- **THEN** the emitted event includes the attempt number and the stable error code alongside `job_id` and `link_id`
