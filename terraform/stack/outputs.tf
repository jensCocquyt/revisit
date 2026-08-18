output "api_url" {
  description = "The demo URL: point the demo script and Bruno cloud environment here."
  value       = "http://${aws_lb.api.dns_name}"
}

output "api_key" {
  description = "x-api-key for link routes; read with terraform output -raw api_key."
  value       = random_password.api_key.result
  sensitive   = true
}

output "rds_endpoint" {
  description = "Host for operator psql (runbook recovery); requires operator_cidr."
  value       = aws_db_instance.main.address
}

# Consumed by the deploy workflow's migration step.
output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "migrate_task_definition_arn" {
  value = aws_ecs_task_definition.migrate.arn
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "migrate_security_group_id" {
  value = aws_security_group.migrate.id
}
