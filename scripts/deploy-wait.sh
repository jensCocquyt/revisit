#!/usr/bin/env bash
# Waits until both services are stable, prints the deployed URL, and writes a
# GitHub step summary when running in Actions. Run from terraform/stack.
set -euo pipefail

cluster=$(terraform output -raw cluster_name)
aws ecs wait services-stable --cluster "$cluster" --services api worker
url=$(terraform output -raw api_url)
echo "API deployed at: $url"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## Demo environment deployed"
    echo ""
    echo "- API: $url"
    echo "- Swagger UI: $url/docs"
    echo '- API key: `terraform output -raw api_key` (from terraform/stack with the same backend config)'
  } >> "$GITHUB_STEP_SUMMARY"
fi
