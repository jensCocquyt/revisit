variable "aws_region" {
  description = "Region for all demo resources."
  type        = string
  default     = "eu-west-1"
}

variable "image_tag" {
  description = "Tag of the api/worker/migrate images to run (the deploy workflow passes the git SHA)."
  type        = string
}

variable "bedrock_model_id" {
  description = "Bedrock model the worker invokes."
  type        = string
}

# The runbook's recovery path is psql against RDS; this opens 5432 to exactly
# one operator address. Empty means no operator access.
variable "operator_cidr" {
  description = "CIDR allowed to reach RDS on 5432 (e.g. 203.0.113.7/32). Empty disables the rule."
  type        = string
  default     = ""
}
