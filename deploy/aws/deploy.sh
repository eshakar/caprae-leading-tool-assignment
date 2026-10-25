#!/usr/bin/env bash
# One-command AWS deployment of SaaSquatch Pro ("cheapest demo" profile).
#
#   Browser ──HTTP──▶ ALB ─┬─ /api/*, /docs, /openapi.json ─▶ ECS Fargate: caprae-api (FastAPI)
#                          └─ everything else ──────────────▶ ECS Fargate: caprae-web (Next.js)
#   caprae-api ──5432──▶ RDS PostgreSQL 17 (private, db.t4g.micro)
#   Images are built by CodeBuild straight from the public GitHub repo and stored in ECR.
#
# Idempotent: re-running reuses what exists, rebuilds images and rolls the services.
# Usage:  AWS_REGION=ap-south-1 ./deploy/aws/deploy.sh          (teardown: ./deploy/aws/teardown.sh)
set -euo pipefail
export MSYS_NO_PATHCONV=1          # Git Bash on Windows: don't rewrite "/api/*" into a Windows path
export AWS_PAGER=""

REGION="${AWS_REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="$REGION"
APP="caprae"
REPO_URL="${REPO_URL:-https://github.com/eshakar/caprae-leading-tool-assignment.git}"
BRANCH="${BRANCH:-main}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

q() { aws "$@" | tr -d '\r'; }      # strip CRLF from aws.exe output on Windows
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
exists() { [[ -n "$1" && "$1" != "None" && "$1" != "null" ]]; }

ACCOUNT=$(q sts get-caller-identity --query Account --output text)
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
log "Account $ACCOUNT · region $REGION"

# ---------------------------------------------------------------- network (default VPC)
VPC=$(q ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
if ! exists "$VPC"; then
  log "No default VPC found - creating one"
  VPC=$(q ec2 create-default-vpc --query 'Vpc.VpcId' --output text)
fi
SUBNETS=$(q ec2 describe-subnets --filters Name=vpc-id,Values="$VPC" Name=default-for-az,Values=true \
  --query 'Subnets[].SubnetId' --output text)
SUBNET_CSV=$(echo "$SUBNETS" | tr '\t ' ',,' | sed 's/,,*/,/g; s/,$//')
log "VPC $VPC · subnets $SUBNET_CSV"

sg() {  # sg <name> <description> -> id (creates if missing)
  local id
  id=$(q ec2 describe-security-groups --filters Name=group-name,Values="$1" Name=vpc-id,Values="$VPC" \
    --query 'SecurityGroups[0].GroupId' --output text)
  if ! exists "$id"; then
    id=$(q ec2 create-security-group --group-name "$1" --description "$2" --vpc-id "$VPC" --query GroupId --output text)
  fi
  echo "$id"
}
allow() {  # allow <sg> <port> <cidr|sg>
  if [[ "$3" == sg-* ]]; then
    aws ec2 authorize-security-group-ingress --group-id "$1" --protocol tcp --port "$2" --source-group "$3" >/dev/null 2>&1 || true
  else
    aws ec2 authorize-security-group-ingress --group-id "$1" --protocol tcp --port "$2" --cidr "$3" >/dev/null 2>&1 || true
  fi
}
ALB_SG=$(sg "$APP-alb-sg" "SaaSquatch Pro load balancer")
SVC_SG=$(sg "$APP-svc-sg" "SaaSquatch Pro ECS tasks")
DB_SG=$(sg "$APP-db-sg" "SaaSquatch Pro database")
allow "$ALB_SG" 80 0.0.0.0/0
allow "$SVC_SG" 8000 "$ALB_SG"
allow "$SVC_SG" 3000 "$ALB_SG"
allow "$DB_SG" 5432 "$SVC_SG"       # database reachable only from the app tasks
log "Security groups: alb=$ALB_SG svc=$SVC_SG db=$DB_SG"

# ---------------------------------------------------------------- ECR
for r in "$APP-api" "$APP-web"; do
  aws ecr describe-repositories --repository-names "$r" >/dev/null 2>&1 || \
    aws ecr create-repository --repository-name "$r" --image-scanning-configuration scanOnPush=true >/dev/null
done
log "ECR repositories ready"

# ---------------------------------------------------------------- RDS PostgreSQL
DB_ID="$APP-db"
DB_STATUS=$(q rds describe-db-instances --db-instance-identifier "$DB_ID" --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null || echo "missing")
if [[ "$DB_STATUS" == "missing" ]]; then
  log "Creating RDS PostgreSQL (takes ~5-10 minutes)"
  aws rds create-db-subnet-group --db-subnet-group-name "$APP-db-subnets" \
    --db-subnet-group-description "SaaSquatch Pro" --subnet-ids $SUBNETS >/dev/null 2>&1 || true
  DB_PASSWORD=$(python -c "import secrets; print(secrets.token_hex(20))")
  PG_VERSION=$(q rds describe-db-engine-versions --engine postgres --engine-version 17 \
    --query 'DBEngineVersions[-1].EngineVersion' --output text)
  aws rds create-db-instance --db-instance-identifier "$DB_ID" --engine postgres --engine-version "$PG_VERSION" \
    --db-instance-class db.t4g.micro --allocated-storage 20 --storage-type gp3 \
    --master-username caprae --master-user-password "$DB_PASSWORD" --db-name caprae \
    --db-subnet-group-name "$APP-db-subnets" --vpc-security-group-ids "$DB_SG" \
    --no-publicly-accessible --backup-retention-period 0 --no-multi-az --storage-encrypted >/dev/null
  # Store the connection string immediately; the endpoint is filled in once the instance is up.
  echo -n "$DB_PASSWORD" > "$WORK/pw"
fi

# ---------------------------------------------------------------- CodeBuild (build images from GitHub)
CB_ROLE="$APP-codebuild-role"
if ! aws iam get-role --role-name "$CB_ROLE" >/dev/null 2>&1; then
  cat > "$WORK/cb-trust.json" <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"codebuild.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
  aws iam create-role --role-name "$CB_ROLE" --assume-role-policy-document "file://$WORK/cb-trust.json" >/dev/null
  aws iam attach-role-policy --role-name "$CB_ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser
  aws iam attach-role-policy --role-name "$CB_ROLE" --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess
  sleep 10   # IAM propagation
fi
CB_ROLE_ARN=$(q iam get-role --role-name "$CB_ROLE" --query Role.Arn --output text)

# The build clones the public repo itself, so CodeBuild needs no GitHub connection/OAuth.
# (\n inside the JSON string = YAML line breaks of the inline buildspec.)
cat > "$WORK/cb.json" <<JSON
{
  "name": "$APP-build",
  "source": {"type": "NO_SOURCE", "buildspec": "version: 0.2\nphases:\n  build:\n    commands:\n      - git clone --depth 1 --branch $BRANCH $REPO_URL src\n      - cd src && bash deploy/aws/build-images.sh\n"},
  "artifacts": {"type": "NO_ARTIFACTS"},
  "environment": {
    "type": "LINUX_CONTAINER", "image": "aws/codebuild/standard:7.0", "computeType": "BUILD_GENERAL1_MEDIUM",
    "privilegedMode": true,
    "environmentVariables": [{"name": "REGISTRY", "value": "$REGISTRY"}]
  },
  "serviceRole": "$CB_ROLE_ARN",
  "timeoutInMinutes": 30
}
JSON
if aws codebuild batch-get-projects --names "$APP-build" --query 'projects[0].name' --output text 2>/dev/null | tr -d '\r' | grep -q "$APP-build"; then
  aws codebuild update-project --cli-input-json "file://$WORK/cb.json" >/dev/null
else
  aws codebuild create-project --cli-input-json "file://$WORK/cb.json" >/dev/null
fi

log "Building Docker images in CodeBuild from $REPO_URL@$BRANCH (~5-8 minutes)"
BUILD_ID=$(q codebuild start-build --project-name "$APP-build" --query build.id --output text)
while :; do
  STATUS=$(q codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].buildStatus' --output text)
  PHASE=$(q codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].currentPhase' --output text)
  printf '   build: %s (%s)\n' "$STATUS" "$PHASE"
  [[ "$STATUS" == "IN_PROGRESS" ]] || break
  sleep 20
done
if [[ "$STATUS" != "SUCCEEDED" ]]; then
  echo "CodeBuild failed. Logs: https://$REGION.console.aws.amazon.com/codesuite/codebuild/projects/$APP-build/history" >&2
  exit 1
fi

# ---------------------------------------------------------------- wait for DB, store secret
log "Waiting for the database to be available"
aws rds wait db-instance-available --db-instance-identifier "$DB_ID"
DB_HOST=$(q rds describe-db-instances --db-instance-identifier "$DB_ID" --query 'DBInstances[0].Endpoint.Address' --output text)
SECRET_NAME="$APP/DATABASE_URL"
if [[ -f "$WORK/pw" ]]; then
  URL="postgresql+psycopg://caprae:$(cat "$WORK/pw")@$DB_HOST:5432/caprae"
  if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value --secret-id "$SECRET_NAME" --secret-string "$URL" >/dev/null
  else
    aws secretsmanager create-secret --name "$SECRET_NAME" --secret-string "$URL" >/dev/null
  fi
  unset URL
fi
SECRET_ARN=$(q secretsmanager describe-secret --secret-id "$SECRET_NAME" --query ARN --output text)
log "Database $DB_HOST · connection string stored in Secrets Manager ($SECRET_NAME)"

# Optional: LLM key for the Outreach Copilot, if you created one yourself with
#   aws secretsmanager create-secret --name caprae/ANTHROPIC_API_KEY --secret-string sk-ant-...
#   aws secretsmanager create-secret --name caprae/GEMINI_API_KEY --secret-string <key>
#   aws secretsmanager create-secret --name caprae/XAI_API_KEY --secret-string xai-...
AI_SECRET_ARN=$(q secretsmanager describe-secret --secret-id "$APP/ANTHROPIC_API_KEY" --query ARN --output text 2>/dev/null || true)
GEMINI_SECRET_ARN=$(q secretsmanager describe-secret --secret-id "$APP/GEMINI_API_KEY" --query ARN --output text 2>/dev/null || true)
XAI_SECRET_ARN=$(q secretsmanager describe-secret --secret-id "$APP/XAI_API_KEY" --query ARN --output text 2>/dev/null || true)

# ---------------------------------------------------------------- IAM for ECS tasks
EXEC_ROLE="$APP-ecs-exec-role"
if ! aws iam get-role --role-name "$EXEC_ROLE" >/dev/null 2>&1; then
  cat > "$WORK/ecs-trust.json" <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
  aws iam create-role --role-name "$EXEC_ROLE" --assume-role-policy-document "file://$WORK/ecs-trust.json" >/dev/null
  aws iam attach-role-policy --role-name "$EXEC_ROLE" --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
  sleep 10
fi
cat > "$WORK/secrets-policy.json" <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"secretsmanager:GetSecretValue",
  "Resource":"arn:aws:secretsmanager:$REGION:$ACCOUNT:secret:$APP/*"}]}
JSON
aws iam put-role-policy --role-name "$EXEC_ROLE" --policy-name "$APP-read-secrets" --policy-document "file://$WORK/secrets-policy.json"
EXEC_ROLE_ARN=$(q iam get-role --role-name "$EXEC_ROLE" --query Role.Arn --output text)

# ---------------------------------------------------------------- load balancer
ALB_ARN=$(q elbv2 describe-load-balancers --names "$APP-alb" --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)
if ! exists "$ALB_ARN"; then
  log "Creating Application Load Balancer"
  ALB_ARN=$(q elbv2 create-load-balancer --name "$APP-alb" --type application --scheme internet-facing \
    --subnets $SUBNETS --security-groups "$ALB_SG" --query 'LoadBalancers[0].LoadBalancerArn' --output text)
fi
ALB_DNS=$(q elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" --query 'LoadBalancers[0].DNSName' --output text)

tg() {  # tg <name> <port> <health path> -> arn
  local arn
  arn=$(q elbv2 describe-target-groups --names "$1" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)
  if ! exists "$arn"; then
    arn=$(q elbv2 create-target-group --name "$1" --protocol HTTP --port "$2" --vpc-id "$VPC" --target-type ip \
      --health-check-path "$3" --health-check-interval-seconds 15 --healthy-threshold-count 2 \
      --query 'TargetGroups[0].TargetGroupArn' --output text)
    aws elbv2 modify-target-group-attributes --target-group-arn "$arn" \
      --attributes Key=deregistration_delay.timeout_seconds,Value=15 >/dev/null
  fi
  echo "$arn"
}
API_TG=$(tg "$APP-api-tg" 8000 /api/health)
WEB_TG=$(tg "$APP-web-tg" 3000 /)

LISTENER=$(q elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --query 'Listeners[?Port==`80`].ListenerArn | [0]' --output text)
if ! exists "$LISTENER"; then
  LISTENER=$(q elbv2 create-listener --load-balancer-arn "$ALB_ARN" --protocol HTTP --port 80 \
    --default-actions Type=forward,TargetGroupArn="$WEB_TG" --query 'Listeners[0].ListenerArn' --output text)
  aws elbv2 create-rule --listener-arn "$LISTENER" --priority 10 \
    --conditions 'Field=path-pattern,Values=/api/*,/docs,/docs/*,/openapi.json' \
    --actions Type=forward,TargetGroupArn="$API_TG" >/dev/null
fi
log "Load balancer http://$ALB_DNS"

# ---------------------------------------------------------------- ECS
aws ecs describe-clusters --clusters "$APP" --query 'clusters[?status==`ACTIVE`].clusterName' --output text | tr -d '\r' | grep -q "$APP" \
  || aws ecs create-cluster --cluster-name "$APP" >/dev/null
for g in api web; do aws logs create-log-group --log-group-name "/ecs/$APP-$g" >/dev/null 2>&1 || true; done
for g in api web; do aws logs put-retention-policy --log-group-name "/ecs/$APP-$g" --retention-in-days 7 >/dev/null; done

AI_SECRET_JSON=""
if exists "$AI_SECRET_ARN"; then AI_SECRET_JSON=",{\"name\":\"ANTHROPIC_API_KEY\",\"valueFrom\":\"$AI_SECRET_ARN\"}"; fi
if exists "$GEMINI_SECRET_ARN"; then AI_SECRET_JSON="$AI_SECRET_JSON,{\"name\":\"GEMINI_API_KEY\",\"valueFrom\":\"$GEMINI_SECRET_ARN\"}"; fi
if exists "$XAI_SECRET_ARN"; then AI_SECRET_JSON="$AI_SECRET_JSON,{\"name\":\"XAI_API_KEY\",\"valueFrom\":\"$XAI_SECRET_ARN\"}"; fi

cat > "$WORK/api-task.json" <<JSON
{
  "family": "$APP-api", "requiresCompatibilities": ["FARGATE"], "networkMode": "awsvpc",
  "cpu": "512", "memory": "1024", "executionRoleArn": "$EXEC_ROLE_ARN",
  "runtimePlatform": {"cpuArchitecture": "X86_64", "operatingSystemFamily": "LINUX"},
  "containerDefinitions": [{
    "name": "api", "image": "$REGISTRY/$APP-api:latest", "essential": true, "stopTimeout": 60,
    "portMappings": [{"containerPort": 8000, "protocol": "tcp"}],
    "environment": [
      {"name": "WEB_CONCURRENCY", "value": "2"},
      {"name": "SEED_SAMPLE_DATA", "value": "true"},
      {"name": "ENVIRONMENT", "value": "production"}
    ],
    "secrets": [{"name": "DATABASE_URL", "valueFrom": "$SECRET_ARN"}$AI_SECRET_JSON],
    "logConfiguration": {"logDriver": "awslogs", "options": {
      "awslogs-group": "/ecs/$APP-api", "awslogs-region": "$REGION", "awslogs-stream-prefix": "api"}}
  }]
}
JSON
cat > "$WORK/web-task.json" <<JSON
{
  "family": "$APP-web", "requiresCompatibilities": ["FARGATE"], "networkMode": "awsvpc",
  "cpu": "256", "memory": "512", "executionRoleArn": "$EXEC_ROLE_ARN",
  "runtimePlatform": {"cpuArchitecture": "X86_64", "operatingSystemFamily": "LINUX"},
  "containerDefinitions": [{
    "name": "web", "image": "$REGISTRY/$APP-web:latest", "essential": true,
    "portMappings": [{"containerPort": 3000, "protocol": "tcp"}],
    "environment": [{"name": "API_URL", "value": "http://$ALB_DNS"}],
    "logConfiguration": {"logDriver": "awslogs", "options": {
      "awslogs-group": "/ecs/$APP-web", "awslogs-region": "$REGION", "awslogs-stream-prefix": "web"}}
  }]
}
JSON
API_TD=$(q ecs register-task-definition --cli-input-json "file://$WORK/api-task.json" --query taskDefinition.taskDefinitionArn --output text)
WEB_TD=$(q ecs register-task-definition --cli-input-json "file://$WORK/web-task.json" --query taskDefinition.taskDefinitionArn --output text)

svc() {  # svc <name> <task def> <target group> <container> <port>
  local status
  status=$(q ecs describe-services --cluster "$APP" --services "$1" --query 'services[0].status' --output text 2>/dev/null || true)
  if [[ "$status" == "ACTIVE" ]]; then
    aws ecs update-service --cluster "$APP" --service "$1" --task-definition "$2" --force-new-deployment >/dev/null
  else
    aws ecs create-service --cluster "$APP" --service-name "$1" --task-definition "$2" --desired-count 1 \
      --launch-type FARGATE --health-check-grace-period-seconds 120 \
      --deployment-configuration "minimumHealthyPercent=0,maximumPercent=200,deploymentCircuitBreaker={enable=true,rollback=true}" \
      --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_CSV],securityGroups=[$SVC_SG],assignPublicIp=ENABLED}" \
      --load-balancers "targetGroupArn=$3,containerName=$4,containerPort=$5" >/dev/null
  fi
}
log "Deploying ECS services"
svc "$APP-api" "$API_TD" "$API_TG" api 8000
svc "$APP-web" "$WEB_TD" "$WEB_TG" web 3000

log "Waiting for services to become stable (~3-5 minutes)"
aws ecs wait services-stable --cluster "$APP" --services "$APP-api" "$APP-web"

for i in $(seq 1 20); do
  if curl -fsS "http://$ALB_DNS/api/health" >/dev/null 2>&1; then break; fi
  sleep 10
done
log "Done"
echo "   App:      http://$ALB_DNS"
echo "   API docs: http://$ALB_DNS/docs"
echo "   Health:   $(curl -s "http://$ALB_DNS/api/health" || echo 'not ready yet')"
