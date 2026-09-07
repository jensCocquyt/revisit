# Networking via the community VPC module — the standard real-world choice
# for this undifferentiated layer (VPC, subnets, internet gateway, routing).
# Everything application-specific (security groups, services, database) stays
# hand-written where the architecture is actually stated.

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 6.0"

  name = local.name
  cidr = "10.0.0.0/16"

  # Two AZs because the ALB and the RDS subnet group both require two.
  azs            = slice(data.aws_availability_zones.available.names, 0, 2)
  public_subnets = ["10.0.0.0/24", "10.0.1.0/24"]

  map_public_ip_on_launch = true
  enable_dns_support      = true
  enable_dns_hostnames    = true

  # The cost decision, stated as configuration: no NAT, no private subnets —
  # tasks get public IPs and security groups do all isolation.
  enable_nat_gateway = false
}
