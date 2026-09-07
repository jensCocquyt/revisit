variable "aws_region" {
  description = "Region for all demo resources."
  type        = string
  default     = "eu-west-1"
}

variable "state_bucket_name" {
  description = "Globally unique name for the Terraform state bucket."
  type        = string
}

# GitHub's sub claim embeds immutable owner and repository ids; the plain
# repo:<owner>/<repo>:* pattern no longer matches. See docs/runbook.md.
variable "github_sub_claim" {
  description = "OIDC sub pattern the deploy role trusts."
  type        = string
  default     = "repo:jensCocquyt@3635860/revisit@1324237451:*"
}

variable "iam_path" {
  description = "Path for all IAM roles the stack root creates; the deploy role's IAM permissions are scoped to it."
  type        = string
  default     = "/revisit-demo/"
}
