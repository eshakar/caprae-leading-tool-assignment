#!/usr/bin/env bash
# Deletes everything deploy/ec2/deploy.sh created (instance + its disk and data, security group, IAM role).
#   AWS_REGION=ap-south-1 ./deploy/ec2/teardown.sh
set -uo pipefail
export MSYS_NO_PATHCONV=1 AWS_PAGER=""
REGION="${AWS_REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="$REGION"
APP="caprae"
q() { aws "$@" | tr -d '\r'; }
log() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

read -r -p "This permanently deletes the SaaSquatch Pro EC2 deployment and its database in $REGION. Type 'delete' to continue: " ok
[[ "$ok" == "delete" ]] || { echo "Aborted."; exit 1; }

log "Instance (and its disk)"
IDS=$(q ec2 describe-instances --filters "Name=tag:Name,Values=$APP-app" \
  "Name=instance-state-name,Values=pending,running,stopping,stopped" --query 'Reservations[].Instances[].InstanceId' --output text)
if [[ -n "$IDS" ]]; then
  aws ec2 terminate-instances --instance-ids $IDS >/dev/null
  aws ec2 wait instance-terminated --instance-ids $IDS
fi

log "Security group"
VPC=$(q ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(q ec2 describe-security-groups --filters Name=group-name,Values="$APP-ec2-sg" Name=vpc-id,Values="$VPC" \
  --query 'SecurityGroups[0].GroupId' --output text)
[[ "$SG" != "None" && -n "$SG" ]] && aws ec2 delete-security-group --group-id "$SG"

log "IAM role and instance profile"
ROLE="$APP-ec2-role"
aws iam remove-role-from-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE" 2>/dev/null
aws iam delete-instance-profile --instance-profile-name "$ROLE" 2>/dev/null
aws iam delete-role-policy --role-name "$ROLE" --policy-name "$APP-read-params" 2>/dev/null
aws iam detach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore 2>/dev/null
aws iam delete-role --role-name "$ROLE" 2>/dev/null

log "Teardown complete. AI keys in SSM (/caprae/*), if you created them, are left in place:"
echo "   aws ssm delete-parameter --name /caprae/GEMINI_API_KEY"
