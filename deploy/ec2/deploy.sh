#!/usr/bin/env bash
# Lowest-cost AWS deployment: ONE free-tier EC2 instance running Postgres + API + web with Docker Compose.
#
#   AWS_REGION=ap-south-1 ./deploy/ec2/deploy.sh
#   AWS_REGION=ap-south-1 DOMAIN=yourname.duckdns.org ./deploy/ec2/deploy.sh   # custom HTTPS hostname
#
# First run creates: a security group (ports 80/443 only, no SSH), an Elastic IP (fixed address), an IAM role for
# SSM, and a free-tier t3/t2.micro instance (Amazon Linux 2023, 20 GiB gp3). Caddy on the instance serves HTTPS
# with automatic Let's Encrypt certificates for DOMAIN (default: <ip>.sslip.io, no signup needed).
# Re-running redeploys the latest images on the same instance via SSM.
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
  # No "-o /dev/null": with MSYS_NO_PATHCONV set, Git Bash's curl can't open it on Windows.
  code=$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $tok" \
    -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json" \
    "https://ghcr.io/v2/$IMAGE_OWNER/$img/manifests/latest" | tail -n1)
  [[ "$code" == "200" ]] || die "ghcr.io/$IMAGE_OWNER/$img:latest is not publicly pullable (HTTP $code).
  1) Make sure the 'Images' GitHub Action has finished successfully.
  2) On GitHub: your profile -> Packages -> $img -> Package settings -> Change visibility -> Public."
  echo "   $img: ok"
done

# ------------------------------------------------------------------ network: security group + fixed IP
VPC=$(q ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
[[ "$VPC" != "None" ]] || die "No default VPC in $REGION"

log "Security group (HTTP + HTTPS only - no SSH; use Session Manager for shell access)"
SG=$(q ec2 describe-security-groups --filters Name=group-name,Values="$APP-ec2-sg" Name=vpc-id,Values="$VPC" \
  --query 'SecurityGroups[0].GroupId' --output text)
if [[ "$SG" == "None" ]]; then
  SG=$(q ec2 create-security-group --group-name "$APP-ec2-sg" --description "SaaSquatch Pro web (HTTP/HTTPS)" \
    --vpc-id "$VPC" --query GroupId --output text)
fi
for port in 80 443; do  # idempotent: an existing rule just returns a duplicate error
  aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port "$port" --cidr 0.0.0.0/0 >/dev/null 2>&1 || true
done

log "Elastic IP (fixed address, so DNS names and links survive a stop/start)"
ALLOC_ID=$(q ec2 describe-addresses --filters "Name=tag:app,Values=$APP" --query 'Addresses[0].AllocationId' --output text)
if [[ "$ALLOC_ID" == "None" || -z "$ALLOC_ID" ]]; then
  ALLOC_ID=$(q ec2 allocate-address --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME},{Key=app,Value=$APP}]" \
    --query AllocationId --output text)
fi
IP=$(q ec2 describe-addresses --allocation-ids "$ALLOC_ID" --query 'Addresses[0].PublicIp' --output text)
DOMAIN="${DOMAIN:-${IP//./-}.sslip.io}"
echo "   $IP  ->  https://$DOMAIN"

associate_ip() {
  local current
  current=$(q ec2 describe-addresses --allocation-ids "$ALLOC_ID" --query 'Addresses[0].InstanceId' --output text)
  [[ "$current" == "$INSTANCE_ID" ]] || aws ec2 associate-address --allocation-id "$ALLOC_ID" \
    --instance-id "$INSTANCE_ID" --allow-reassociation >/dev/null
}

# ------------------------------------------------------------------ payload run on the instance
COMPOSE_B64=$(base64 -w0 < "$HERE/docker-compose.yml")
PAYLOAD=$(printf 'COMPOSE_B64=%s\nIMAGE_OWNER=%s\nDOMAIN=%s\n' "$COMPOSE_B64" "$IMAGE_OWNER" "$DOMAIN"; tr -d '\r' < "$HERE/bootstrap.sh" | sed '1d')

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
  associate_ip
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
  # Ask about just these two types (no pagination); which one is free depends on the account and region.
  ELIGIBLE=$(q ec2 describe-instance-types --instance-types t3.micro t2.micro \
    --query "InstanceTypes[?FreeTierEligible].InstanceType" --output text)
  if [[ "$ELIGIBLE" == *t3.micro* ]]; then TYPE=t3.micro
  elif [[ "$ELIGIBLE" == *t2.micro* ]]; then TYPE=t2.micro
  else TYPE=t3.micro; fi
  AMI=$(q ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
    --query Parameter.Value --output text)

  log "Launching $TYPE ($AMI)"
  USER_DATA="$(mktemp)"
  printf '#!/bin/bash\n%s\n' "$PAYLOAD" > "$USER_DATA"
  INSTANCE_ID=$(q ec2 run-instances --image-id "$AMI" --instance-type "$TYPE" \
    --security-group-ids "$SG" --iam-instance-profile Name="$ROLE" \
    --user-data "file://$(cygpath -m "$USER_DATA" 2>/dev/null || echo "$USER_DATA")" \
    --metadata-options HttpTokens=required,HttpEndpoint=enabled \
    --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=20,VolumeType=gp3,DeleteOnTermination=true}' \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME},{Key=app,Value=$APP}]" \
                         "ResourceType=volume,Tags=[{Key=Name,Value=$NAME},{Key=app,Value=$APP}]" \
    --query 'Instances[0].InstanceId' --output text)
  rm -f "$USER_DATA"
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
  associate_ip
fi

log "Waiting for http://$IP (first boot installs Docker and pulls images: ~3-6 min)"
for _ in $(seq 1 60); do
  if curl -fsS -m 5 "http://$IP/api/health" >/dev/null 2>&1; then
    log "Live over HTTP: http://$IP - waiting for the HTTPS certificate for $DOMAIN"
    HTTPS_OK=""
    for _ in $(seq 1 18); do
      if curl -fsS -m 10 "https://$DOMAIN/api/health" >/dev/null 2>&1; then HTTPS_OK=1; break; fi
      sleep 10
    done
    if [[ -n "$HTTPS_OK" ]]; then
      log "Live: https://$DOMAIN"
    else
      echo "   HTTPS not ready yet (certificate still being issued). Check: cd /opt/caprae && sudo docker compose logs caddy"
    fi
    echo "   Instance: $INSTANCE_ID ($REGION)   ·   Elastic IP: $IP   ·   Shell: aws ssm start-session --target $INSTANCE_ID"
    echo "   Logs:     sudo tail -f /var/log/caprae-deploy.log  ·  cd /opt/caprae && sudo docker compose logs -f"
    exit 0
  fi
  sleep 10
done
die "App did not become healthy in 10 minutes. Check: aws ssm start-session --target $INSTANCE_ID, then sudo tail -100 /var/log/caprae-deploy.log"
