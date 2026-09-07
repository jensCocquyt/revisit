# Secrets are generated here, stored only in Secrets Manager, and injected
# into tasks via task-definition `secrets` blocks — never plaintext in task
# definitions, tfvars, or workflow logs. recovery_window_in_days = 0 forces
# hard deletes so destroy → apply never collides with a soft-deleted secret.

# One secret, two connection-string dialects: node-postgres verifies
# certificates on sslmode=require (which fails against RDS's private CA) and
# wants no-verify, while psycopg and dbmate treat require as encrypt-without-
# verify and reject "no-verify" as a value. Same credentials either way.
resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${local.name}/database-url"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id

  secret_string = jsonencode({
    node  = "postgres://${aws_db_instance.main.username}:${random_password.db.result}@${aws_db_instance.main.address}:5432/${aws_db_instance.main.db_name}?sslmode=no-verify"
    libpq = "postgres://${aws_db_instance.main.username}:${random_password.db.result}@${aws_db_instance.main.address}:5432/${aws_db_instance.main.db_name}?sslmode=require"
  })
}

# Spend protection for the public API, not authentication. Rotates on every
# apply that recreates it; read with `terraform output -raw api_key`.
resource "random_password" "api_key" {
  length  = 40
  special = false
}

resource "aws_secretsmanager_secret" "api_key" {
  name                    = "${local.name}/api-key"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "api_key" {
  secret_id     = aws_secretsmanager_secret.api_key.id
  secret_string = random_password.api_key.result
}
