# Image repositories live in bootstrap, not the demo root, so destroying the
# environment never deletes images: destroy → apply needs no rebuild.

locals {
  repositories = ["api", "worker", "migrate"]
}

resource "aws_ecr_repository" "service" {
  for_each = toset(local.repositories)

  name         = "revisit/${each.key}"
  force_delete = true
}

# Cap storage cost: only the most recent images matter for an ephemeral demo.
resource "aws_ecr_lifecycle_policy" "service" {
  for_each   = aws_ecr_repository.service
  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "keep the last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      }
    ]
  })
}
