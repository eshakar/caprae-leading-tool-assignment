#!/bin/bash
# Runs ON the EC2 instance (as root): first boot via user-data, and on every redeploy via SSM Run Command.
# Idempotent: installs Docker + Compose and swap once, keeps the generated DB password, refreshes AI keys from
# SSM Parameter Store, then pulls the latest images and (re)starts the stack.
# deploy.sh prepends `COMPOSE_B64=...` and `IMAGE_OWNER=...` lines before running this.
set -euo pipefail
exec > >(tee -a /var/log/caprae-deploy.log) 2>&1
echo "=== caprae deploy $(date -u +%FT%TZ) ==="

APP_DIR=/opt/caprae
mkdir -p "$APP_DIR"

# 2 GiB swap: 1 GiB of RAM is tight for Postgres + API + Next.js.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
  sysctl -w vm.swappiness=20 && echo "vm.swappiness=20" > /etc/sysctl.d/99-caprae.conf
fi

if ! command -v docker >/dev/null; then
  dnf install -y docker
  systemctl enable --now docker
fi
if ! docker compose version >/dev/null 2>&1; then
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

echo "$COMPOSE_B64" | base64 -d > "$APP_DIR/docker-compose.yml"

# .env: the DB password is generated here once and never leaves the instance.
ENV_FILE="$APP_DIR/.env"
touch "$ENV_FILE" && chmod 600 "$ENV_FILE"
get_env() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }
PG_PASS=$(get_env POSTGRES_PASSWORD)
[ -n "$PG_PASS" ] || PG_PASS=$(openssl rand -hex 24)

TOKEN=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
REGION=$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region)

{
  echo "POSTGRES_PASSWORD=$PG_PASS"
  echo "IMAGE_OWNER=$IMAGE_OWNER"
  echo "IMAGE_TAG=${IMAGE_TAG:-latest}"
  # Optional AI keys, stored by you as SecureString parameters /caprae/<NAME>.
  for name in ANTHROPIC_API_KEY GEMINI_API_KEY XAI_API_KEY; do
    val=$(aws ssm get-parameter --region "$REGION" --name "/caprae/$name" --with-decryption \
          --query Parameter.Value --output text 2>/dev/null || true)
    if [ -n "$val" ] && [ "$val" != "None" ]; then echo "$name=$val"; fi
  done
} > "$ENV_FILE.new"
mv "$ENV_FILE.new" "$ENV_FILE" && chmod 600 "$ENV_FILE"

cd "$APP_DIR"
docker compose pull --quiet
docker compose up -d --remove-orphans
docker image prune -f >/dev/null
docker compose ps
echo "=== deploy finished ==="
