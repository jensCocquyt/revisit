# Bootstrap root: the durable resources the ephemeral demo environment depends
# on — state bucket, image repositories, and the GitHub deploy role. Applied
# once by a human with their own credentials; uses local state on purpose
# (a deploy role cannot create the bucket its own state lives in).

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

# The GitHub OIDC provider already exists in the account (created for the
# Bedrock eval role — see docs/runbook.md); reference, don't recreate.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}
