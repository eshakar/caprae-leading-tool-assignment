#!/usr/bin/env bash
# Deletes everything deploy.sh created, so the demo stops costing money.
# Usage:  AWS_REGION=ap-south-1 ./deploy/aws/teardown.sh
set -uo pipefail
export MSYS_NO_PATHCONV=1
export AWS_PAGER=""
REGION="${AWS_REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="$REGION"
APP="caprae"
q() { aws "$@" | tr -d '\r'; }
log() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

read -r -p "This permanently deletes the SaaSquatch Pro deployment and its database in $REGION. Type 'delete' to continue: " ok
[[ "$ok" == "delete" ]] || { echo "Aborted."; exit 1; }

log "ECS services and cluster"
for s in "$APP-web" "$APP-api"; do
  aws ecs update-service --cluster "$APP" --service "$s" --desired-count 0 >/dev/null 2>&1
  aws ecs delete-service --cluster "$APP" --service "$s" --force >/dev/null 2>&1
done
aws ecs wait services-inactive --cluster "$APP" --services "$APP-web" "$APP-api" 2>/dev/null
for fam in "$APP-api" "$APP-web"; do
  for td in $(q ecs list-task-definitions --family-prefix "$fam" --query 'taskDefinitionArns[]' --output text); do
    aws ecs deregister-task-definition --task-definition "$td" >/dev/null 2>&1
  done
done
aws ecs delete-cluster --cluster "$APP" >/dev/null 2>&1

log "Load balancer and target groups"
ALB_ARN=$(q elbv2 describe-load-balancers --names "$APP-alb" --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null)
if [[ -n "$ALB_ARN" && "$ALB_ARN" != "None" ]]; then
  aws elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN"
  aws elbv2 wait load-balancers-deleted --load-balancer-arns "$ALB_ARN"
fi
for t in "$APP-api-tg" "$APP-web-tg"; do
  arn=$(q elbv2 describe-target-groups --names "$t" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null)
  [[ -n "$arn" && "$arn" != "None" ]] && aws elbv2 delete-target-group --target-group-arn "$arn"
done

log "RDS database (no final snapshot)"
aws rds delete-db-instance --db-instance-identifier "$APP-db" --skip-final-snapshot --delete-automated-backups >/dev/null 2>&1 \
  && aws rds wait db-instance-deleted --db-instance-identifier "$APP-db"
aws rds delete-db-subnet-group --db-subnet-group-name "$APP-db-subnets" >/dev/null 2>&1

log "Secrets, images, build project, logs"
aws secretsmanager delete-secret --secret-id "$APP/DATABASE_URL" --force-delete-without-recovery >/dev/null 2>&1
for r in "$APP-api" "$APP-web"; do aws ecr delete-repository --repository-name "$r" --force >/dev/null 2>&1; done
aws codebuild delete-project --name "$APP-build" >/dev/null 2>&1
for g in "/ecs/$APP-api" "/ecs/$APP-web" "/aws/codebuild/$APP-build"; do aws logs delete-log-group --log-group-name "$g" >/dev/null 2>&1; done

log "IAM roles"
aws iam delete-role-policy --role-name "$APP-ecs-exec-role" --policy-name "$APP-read-secrets" >/dev/null 2>&1
aws iam detach-role-policy --role-name "$APP-ecs-exec-role" --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy >/dev/null 2>&1
aws iam delete-role --role-name "$APP-ecs-exec-role" >/dev/null 2>&1
for p in arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser arn:aws:iam::aws:policy/CloudWatchLogsFullAccess; do
  aws iam detach-role-policy --role-name "$APP-codebuild-role" --policy-arn "$p" >/dev/null 2>&1
done
aws iam delete-role --role-name "$APP-codebuild-role" >/dev/null 2>&1

log "Security groups"
sleep 20  # ENIs from tasks/ALB take a moment to release
VPC=$(q ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
for n in "$APP-db-sg" "$APP-svc-sg" "$APP-alb-sg"; do
  id=$(q ec2 describe-security-groups --filters Name=group-name,Values="$n" Name=vpc-id,Values="$VPC" --query 'SecurityGroups[0].GroupId' --output text)
  [[ -n "$id" && "$id" != "None" ]] && { aws ec2 delete-security-group --group-id "$id" 2>/dev/null || echo "   $n still in use - re-run teardown in a minute"; }
done
log "Teardown complete. (The optional caprae/ANTHROPIC_API_KEY secret, if you created it, is left untouched.)"
