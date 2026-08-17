# All isolation lives here: the ALB is the only public entry point, tasks
# accept nothing (worker/migrate) or ALB-only (API), and RDS accepts 5432 from
# the task security groups plus at most one operator address.

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Public HTTP entry point"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP from anywhere (demo URL)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description     = "To the API tasks only"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }
}

resource "aws_security_group" "api" {
  name        = "${local.name}-api"
  description = "API tasks: ALB-only inbound"
  vpc_id      = aws_vpc.main.id

  egress {
    description = "Database, ECR, logs, secrets"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group_rule" "api_from_alb" {
  type                     = "ingress"
  security_group_id        = aws_security_group.api.id
  from_port                = 3000
  to_port                  = 3000
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
  description              = "App traffic from the ALB"
}

resource "aws_security_group" "worker" {
  name        = "${local.name}-worker"
  description = "Worker tasks: no inbound"
  vpc_id      = aws_vpc.main.id

  egress {
    description = "Page fetches, Bedrock, database, ECR, logs, secrets"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "migrate" {
  name        = "${local.name}-migrate"
  description = "One-off migration tasks: no inbound"
  vpc_id      = aws_vpc.main.id

  egress {
    description = "Database, ECR, logs, secrets"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "rds" {
  name        = "${local.name}-rds"
  description = "PostgreSQL: task SGs plus optional operator CIDR"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "API tasks"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    security_groups = [
      aws_security_group.api.id,
      aws_security_group.worker.id,
      aws_security_group.migrate.id,
    ]
  }

  dynamic "ingress" {
    for_each = var.operator_cidr == "" ? [] : [var.operator_cidr]

    content {
      description = "Operator psql for runbook recovery"
      from_port   = 5432
      to_port     = 5432
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }
}
