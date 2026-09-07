# cloud-observability Delta

## ADDED Requirements

### Requirement: Metric filters derive metrics from existing worker logs
CloudWatch metric filters over the worker log group SHALL derive metrics from the worker's existing structured events with no application changes: failed-job counts dimensioned by `error_code` (from `{"msg": "job failed"}` lines), deadline-drop counts (from `{"msg": "deadline dropped"}`), and evidence-drop counts (from `{"msg": "evidence dropped"}`).

#### Scenario: Failure counts by error code
- **GIVEN** the worker logs a `job failed` event with `error_code: "unsupported_content_type"`
- **WHEN** the metric filter processes the log line
- **THEN** the failed-job metric increments with that `error_code` dimension

#### Scenario: Drop events become metrics
- **WHEN** the worker logs a `deadline dropped` or `evidence dropped` event
- **THEN** the corresponding drop metric increments

### Requirement: Minimal dashboard and alarm
A CloudWatch dashboard SHALL present the log-derived metrics (failures by error code, drop counts) alongside log widgets for both services, and one alarm SHALL fire on an elevated failed-job count. The alarm is for visibility, not paging: it SHALL NOT require a notification target to exist.

#### Scenario: Dashboard shows a processing failure
- **GIVEN** a job has terminally failed in the cloud environment
- **WHEN** the operator opens the dashboard
- **THEN** the failure is visible as a metric datapoint with its error code and the underlying log line is reachable from the same dashboard

#### Scenario: Alarm on failure burst
- **WHEN** the failed-job metric breaches its threshold within the evaluation window
- **THEN** the alarm enters the alarm state and returns to OK after the window clears
