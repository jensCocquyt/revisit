#!/usr/bin/env bash
# Runs database migrations as a one-off ECS task and fails on a non-zero exit
# code. Run from terraform/stack after apply; reads the terraform outputs.
set -euo pipefail

cluster=$(terraform output -raw cluster_name)
task_def=$(terraform output -raw migrate_task_definition_arn)
subnets=$(terraform output -json public_subnet_ids | jq -r 'join(",")')
sg=$(terraform output -raw migrate_security_group_id)

task_arn=$(aws ecs run-task \
  --cluster "$cluster" \
  --task-definition "$task_def" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$sg],assignPublicIp=ENABLED}" \
  --query 'tasks[0].taskArn' --output text)
echo "migration task: $task_arn"

aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task_arn"
exit_code=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task_arn" \
  --query 'tasks[0].containers[0].exitCode' --output text)
if [ "$exit_code" != "0" ]; then
  echo "migration task exited with code $exit_code - see the /revisit-demo/migrate log group" >&2
  exit 1
fi
