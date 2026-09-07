# Metrics are derived from the worker's existing single-line JSON events —
# no metrics code in the app. Filter patterns match the exact `msg` values
# emitted by worker/jobs.py.

# Total failures (alarm target): CloudWatch cannot sum a dimensioned metric
# across its dimension values in an alarm, so the total gets its own filter.
resource "aws_cloudwatch_log_metric_filter" "job_failed" {
  name           = "job-failed"
  log_group_name = aws_cloudwatch_log_group.worker.name
  pattern        = "{ $.msg = \"job failed\" }"

  metric_transformation {
    name      = "JobFailed"
    namespace = "Revisit"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "job_failed_by_code" {
  name           = "job-failed-by-code"
  log_group_name = aws_cloudwatch_log_group.worker.name
  pattern        = "{ $.msg = \"job failed\" }"

  metric_transformation {
    name      = "JobFailedByCode"
    namespace = "Revisit"
    value     = "1"

    dimensions = {
      error_code = "$.error_code"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "deadline_dropped" {
  name           = "deadline-dropped"
  log_group_name = aws_cloudwatch_log_group.worker.name
  pattern        = "{ $.msg = \"deadline dropped\" }"

  metric_transformation {
    name      = "DeadlineDropped"
    namespace = "Revisit"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "evidence_dropped" {
  name           = "evidence-dropped"
  log_group_name = aws_cloudwatch_log_group.worker.name
  pattern        = "{ $.msg = \"evidence dropped\" }"

  metric_transformation {
    name      = "EvidenceDropped"
    namespace = "Revisit"
    value     = "1"
  }
}

# Visibility, not paging: no notification target on purpose.
resource "aws_cloudwatch_metric_alarm" "job_failures" {
  alarm_name          = "${local.name}-job-failures"
  alarm_description   = "Elevated terminal job failures in the worker"
  namespace           = "Revisit"
  metric_name         = "JobFailed"
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = local.name

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "Job failures by error code"
          region = var.aws_region
          stat   = "Sum"
          period = 300
          metrics = [
            [{ expression = "SEARCH('{Revisit,error_code} MetricName=\"JobFailedByCode\"', 'Sum', 300)", label = "", id = "failures" }],
          ]
          view = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "Failures and drops"
          region = var.aws_region
          stat   = "Sum"
          period = 300
          metrics = [
            ["Revisit", "JobFailed"],
            ["Revisit", "DeadlineDropped"],
            ["Revisit", "EvidenceDropped"],
          ]
          view = "timeSeries"
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Worker events"
          region = var.aws_region
          query  = "SOURCE '${aws_cloudwatch_log_group.worker.name}' | fields @timestamp, @message | sort @timestamp desc | limit 50"
          view   = "table"
        }
      },
      {
        type   = "log"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "API events"
          region = var.aws_region
          query  = "SOURCE '${aws_cloudwatch_log_group.api.name}' | fields @timestamp, @message | sort @timestamp desc | limit 50"
          view   = "table"
        }
      },
    ]
  })
}
