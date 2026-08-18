# Smallest viable managed PostgreSQL. Publicly resolvable but SG-gated: the
# runbook's recovery path is psql, and an SG-allowlisted endpoint is the
# cheapest defensible way to allow it (no bastion, no tunnel). skip_final_
# snapshot and no deletion protection are deliberate: destroy must be clean,
# and data loss on destroy is the point of an ephemeral environment.

resource "random_password" "db" {
  length  = 32
  special = false # keeps the password safe to embed in connection URLs
}

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.public[*].id
}

resource "aws_db_instance" "main" {
  identifier = local.name

  engine         = "postgres"
  engine_version = "17"
  instance_class = "db.t4g.micro"

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = "revisit"
  username = "revisit"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = true
  multi_az               = false

  skip_final_snapshot = true
  deletion_protection = false
}
