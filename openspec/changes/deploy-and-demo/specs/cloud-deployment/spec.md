# cloud-deployment Delta

## ADDED Requirements

### Requirement: Terraform provisions the full demo environment from zero
The cloud environment SHALL be defined entirely in Terraform, split into a durable bootstrap root (state bucket, ECR repositories, deploy role) and an ephemeral demo root (everything else: networking, ECS Fargate services for API and worker, RDS PostgreSQL, load balancer, secrets, IAM task roles, log groups). Applying the demo root against an account holding only the bootstrap resources SHALL produce a working environment with no manual console steps.

#### Scenario: Provision from zero
- **GIVEN** an AWS account containing only the bootstrap resources and pushed images
- **WHEN** the demo root is applied
- **THEN** the API becomes reachable at the load balancer URL and reports a healthy `GET /health` once migrations have run

#### Scenario: Destroy and re-apply round-trips cleanly
- **GIVEN** a provisioned demo environment
- **WHEN** `terraform destroy` completes and `terraform apply` is run again
- **THEN** both commands succeed without manual cleanup (no soft-deleted secret collisions, no final-snapshot prompts, no orphaned resources blocking either direction)

### Requirement: No long-lived credentials and least-privilege runtime roles
No long-lived AWS credentials SHALL exist in the repository, task definitions, or environment files. The worker task role SHALL allow `bedrock:InvokeModel` and nothing else; the API task SHALL have no AWS permissions beyond the standard execution role (image pull, log write, secret fetch). Database credentials SHALL live only in Secrets Manager and be injected into tasks at launch, never appearing in task-definition environment blocks, tfvars files, or workflow logs.

#### Scenario: Worker calls Bedrock via its task role
- **WHEN** the worker enriches a link with `ENRICHER=bedrock`
- **THEN** the Bedrock call authenticates via the task role's temporary credentials with no access keys configured anywhere

#### Scenario: API task cannot call AWS services
- **WHEN** the API task's credentials are used to attempt any AWS API call
- **THEN** the call is denied because the task role grants nothing

#### Scenario: Database credentials stay out of definitions
- **WHEN** the registered task definitions are inspected
- **THEN** `DATABASE_URL` appears only as a Secrets Manager reference, not as a plaintext value

### Requirement: Cost-disciplined network design without NAT
The environment SHALL avoid NAT gateways: tasks run in public subnets with public IPs and are isolated by security groups (no inbound to the worker, ALB-only inbound to the API, task-SG plus operator-CIDR inbound to RDS on 5432). The README SHALL document the estimated monthly cost, the teardown command, and the trade-offs of this design against the NAT/private-subnet alternative.

#### Scenario: Worker reaches AWS services without NAT
- **WHEN** the worker task pulls its image, writes logs, and calls Bedrock
- **THEN** all traffic egresses via the internet gateway with no NAT gateway provisioned in the VPC

#### Scenario: Direct access to tasks is blocked
- **WHEN** a connection is attempted from the internet directly to a task's public IP
- **THEN** the security groups reject it (API traffic must arrive through the load balancer)

#### Scenario: Database access is gated
- **WHEN** a client outside the task security groups and the operator CIDR attempts to connect to RDS
- **THEN** the connection is refused

### Requirement: Service logs land in CloudWatch
Each service SHALL write its existing single-line JSON logs to its own CloudWatch log group via the awslogs driver, with a bounded retention period. No logging changes SHALL be made to the applications.

#### Scenario: Worker events are queryable
- **WHEN** the worker processes a job in the cloud environment
- **THEN** its structured events (`job claimed`, `job completed`, `job failed`, ...) appear as JSON lines in the worker log group
