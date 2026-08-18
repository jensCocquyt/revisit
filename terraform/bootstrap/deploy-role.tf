# The role deploy.yml assumes via OIDC. Deliberately service-scoped rather
# than action-scoped: a true least-action policy for a Terraform apply role is
# unmaintainable, so the honest trade-off is full access to the services the
# stack root manages, resource-scoped where cheap (IAM path, state bucket), and
# no long-lived credentials anywhere. The Bedrock eval role stays separate.

resource "aws_iam_role" "deploy" {
  name = "revisit-demo-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = data.aws_iam_openid_connect_provider.github.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = var.github_sub_claim
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "deploy" {
  name = "deploy"
  role = aws_iam_role.deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ManagedServices"
        Effect = "Allow"
        Action = [
          "ec2:*",
          "ecs:*",
          "ecr:*",
          "rds:*",
          "elasticloadbalancing:*",
          "logs:*",
          "cloudwatch:*",
          "secretsmanager:*",
        ]
        Resource = "*"
      },
      {
        Sid    = "TaskRolesInDemoPath"
        Effect = "Allow"
        Action = [
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:GetRole",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:UpdateAssumeRolePolicy",
          "iam:PutRolePolicy",
          "iam:GetRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
          "iam:ListInstanceProfilesForRole",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
        ]
        Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role${var.iam_path}*"
      },
      {
        Sid      = "PassTaskRolesToEcs"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role${var.iam_path}*"
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
      {
        # ECS, ELB, and RDS create service-linked roles on first use.
        Sid      = "ServiceLinkedRoles"
        Effect   = "Allow"
        Action   = "iam:CreateServiceLinkedRole"
        Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/aws-service-role/*"
      },
      {
        Sid      = "StateBucketList"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.tfstate.arn
      },
      {
        Sid    = "StateObjects"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
        ]
        Resource = "${aws_s3_bucket.tfstate.arn}/*"
      },
    ]
  })
}
