output "deploy_role_arn" {
  description = "Set as repository variable AWS_DEPLOY_ROLE_ARN."
  value       = aws_iam_role.deploy.arn
}

output "state_bucket" {
  description = "Set as repository variable TF_STATE_BUCKET; also used for local -backend-config."
  value       = aws_s3_bucket.tfstate.bucket
}

output "ecr_repository_urls" {
  description = "Push targets for the api, worker, and migrate images."
  value       = { for name, repo in aws_ecr_repository.service : name => repo.repository_url }
}
