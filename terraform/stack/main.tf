# Stack root: the entire runtime environment, ephemeral by design. Everything
# here must survive `terraform destroy` → `terraform apply` with no manual
# cleanup. Durable prerequisites (state bucket, ECR, deploy role) live in
# ../bootstrap.

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Bucket and region are supplied at init time (-backend-config), so the repo
  # carries no account-specific names. Locking is S3-native; no DynamoDB.
  backend "s3" {
    key          = "demo/terraform.tfstate"
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name     = "revisit-demo"
  iam_path = "/revisit-demo/"

  # Repositories are created by the bootstrap root; the URL shape is fixed.
  ecr_base = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com/revisit"
}
