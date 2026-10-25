#!/usr/bin/env bash
# Lowest-cost AWS deployment: ONE free-tier EC2 instance running Postgres + API + web with Docker Compose.
#
#   AWS_REGION=ap-south-1 ./deploy/ec2/deploy.sh
#
# First run creates: a security group (port 80 only, no SSH), an IAM role for SSM, and a t3.micro instance
# (Amazon Linux 2023, 20 GiB gp3). Re-running redeploys the latest images on the same instance via SSM.
# Images come from GitHub Container Registry (built by .github/workflows/images.yml).
# Optional AI key (stored encrypted in SSM Parameter Store, read by the instance at deploy time):
#   aws ssm put-parameter --name /caprae/GEMINI_API_KEY --type SecureString --value '<key>' --overwrite
set -euo pipefail
export MSYS_NO_PATHCONV=1 AWS_PAGER=""
REGION="${AWS_REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="$REGION"
APP="caprae"
NAME="$APP-app"
IMAGE_OWNER="${IMAGE_OWNER:-eshakar}"
HERE="$(cd "$(dirname "$0")" && pwd)"
q() { aws "$@" | tr -d '\r'; }
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

command -v aws >/dev/null || die "AWS CLI v2 not found on PATH"
ACCOUNT=$(q sts get-caller-identity --query Account --output text) || die "Not signed in - run 'aws login' or 'aws configure'"
log "Account $ACCOUNT · region $REGION"

# ------------------------------------------------------------------ images must be publicly pullable
log "Checking container images on ghcr.io/$IMAGE_OWNER"
for img in caprae-api caprae-web; do
  tok=$(curl -fsS "https://ghcr.io/token?scope=repository:$IMAGE_OWNER/$img:pull" | sed -E 's/.*"token":"([^"]+)".*/\1/' || true)
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $tok" \
    -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json" \
    "https://ghcr.io/v2/$IMAGE_OWNER/$img/manifests/latest")
  [[ "$code" == "200" ]] || die "ghcr.io/$IMAGE_OWNER/$img:latest is not publicly pullable (HTTP $code).
  1) Make sure the 'Images' GitHub Action has finished successfully.
  2) On GitHub: your profile -> Packages -> $img -> Package settings -> Change visibility -> Public."
  echo "   $img: ok"
done

# ------------------------------------------------------------------ payload run on the instance
COMPOSE_B64=$(base64 -w0 < "$HERE/docker-compose.yml")
PAYLOAD=$(printf 'COMPOSE_B64=%s\nIMAGE_OWNER=%s\n' "$COMPOSE_B64" "$IMAGE_OWNER"; tr -d '\r' < "$HERE/bootstrap.sh" | sed '1d')

INSTANCE_ID=$(q ec2 describe-instances \
  --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)

if [[ "$INSTANCE_ID" != "None" && -n "$INSTANCE_ID" ]]; then
  # ---------------------------------------------------------------- redeploy on the existing instance
  STATE=$(q ec2 describe-instances --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].State.Name' --output text)
  if [[ "$STATE" == "stopped" ]]; then
    log "Starting stopped instance $INSTANCE_ID"
    aws ec2 start-instances --instance-ids "$INSTANCE_ID" >/dev/null
  fi
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
  log "Redeploying latest images on $INSTANCE_ID via SSM"
  CMD_B64=$(printf '#!/bin/bash\n%s\n' "$PAYLOAD" | base64 -w0)
  for _ in $(seq 1 30); do  # the SSM agent needs a moment after boot
    [[ $(q ssm describe-instance-information --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
          --query 'length(InstanceInformationList)' --output text) == "1" ]] && break
    sleep 10
  done
  CMD_ID=$(q ssm send-command --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript \
    --comment "caprae redeploy" --parameters "{\"commands\":[\"echo $CMD_B64 | base64 -d | bash\"]}" \
    --timeout-seconds 900 --query Command.CommandId --output text)
  aws ssm wait command-executed --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" 2>/dev/null || true
  q ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
    --query '{status:Status,output:StandardOutputContent,errors:StandardErrorContent}' --output text | tail -25
else
  # ---------------------------------------------------------------- first deployment
  VPC=$(q ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
  [[ "$VPC" != "None" ]] || die "No default VPC in $REGION"

  log "Security group (HTTP only - no SSH; use Session Manager for shell access)"
  SG=$(q ec2 describe-security-groups --filters Name=group-name,Values="$APP-ec2-sg" Name=vpc-id,Values="$VPC" \
    --query 'SecurityGroups[0].GroupId' --output text)
  if [[ "$SG" == "None" ]]; then
    SG=$(q ec2 create-security-group --group-name "$APP-ec2-sg" --description "SaaSquatch Pro web (HTTP)" \
      --vpc-id "$VPC" --query GroupId --output text)
    aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 80 --cidr 0.0.0.0/0 >/dev/null
  fi

  log "IAM role for SSM (shell access + reading /caprae/* parameters)"
  ROLE="$APP-ec2-role"
  if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
    aws iam create-role --role-name "$ROLE" --assume-role-policy-document \
      '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
    aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
    aws iam put-role-policy --role-name "$ROLE" --policy-name "$APP-read-params" --policy-document \
      "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"ssm:GetParameter\",\"Resource\":\"arn:aws:ssm:$REGION:$ACCOUNT:parameter/$APP/*\"}]}"
  fi
  if ! aws iam get-instance-profile --instance-profile-name "$ROLE" >/dev/null 2>&1; then
    aws iam create-instance-profile --instance-profile-name "$ROLE" >/dev/null
    aws iam add-role-to-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE"
    sleep 15  # new instance profiles take a few seconds to become usable
  fi

  # Prefer a free-tier-eligible type: t3.micro (most regions) or t2.micro.
  TYPE=$(q ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true \
    --query "InstanceTypes[?InstanceType=='t3.micro' || InstanceType=='t2.micro'].InstanceType | sort(@) | [-1]" --output text)
  [[ -n "$TYPE" && "$TYPE" != "None" ]] || TYPE=t3.micro
  AMI=$(q ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
    --query Parameter.Value --output text)

  log "Launching $TYPE ($AMI)"
  USER_DATA="$(mktemp)"
  printf '#!/bin/bash\n%s\n' "$PAYLOAD" > "$USER_DATA"
  INSTANCE_ID=$(q ec2 run-instances --image-id "$AMI" --instance-type "$TYPE" \
    --security-group-ids "$SG" --iam-instance-profile Name="$ROLE" \
    --user-data "file://$USER_DATA" \
    --metadata-options HttpTokens=required,HttpEndpoint=enabled \
    --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=20,VolumeType=gp3,DeleteOnTermination=true}' \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME},{Key=app,Value=$APP}]" \
                         "ResourceType=volume,Tags=[{Key=Name,Value=$NAME},{Key=app,Value=$APP}]" \
    --query 'Instances[0].InstanceId' --output text)
  rm -f "$USER_DATA"
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
fi

IP=$(q ec2 describe-instances --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
URL="http://$IP"
log "Waiting for $URL (first boot installs Docker and pulls images: ~3-6 min)"
for i in $(seq 1 60); do
  if curl -fsS -m 5 -o /dev/null "$URL/api/health"; then
    log "Live: $URL"
    echo "   Instance: $INSTANCE_ID ($REGION)   ·   Shell: aws ssm start-session --target $INSTANCE_ID"
    echo "   Logs:     sudo tail -f /var/log/caprae-deploy.log  ·  cd /opt/caprae && sudo docker compose logs -f"
    exit 0
  fi
  sleep 10
done
die "App did not become healthy in 10 minutes. Check: aws ssm start-session --target $INSTANCE_ID, then sudo tail -100 /var/log/caprae-deploy.log"
