#!/usr/bin/env bash
# Runs inside AWS CodeBuild (see deploy.sh): builds both images and pushes them to ECR.
# Expects REGISTRY and AWS_DEFAULT_REGION; run from the repository root.
set -euo pipefail
TAG=$(git rev-parse --short HEAD 2>/dev/null || echo latest)
aws ecr get-login-password --region "$AWS_DEFAULT_REGION" | docker login --username AWS --password-stdin "$REGISTRY"
for app in api web; do
  dir=$([[ $app == api ]] && echo fastapi-caprae || echo nextjs-caprae)
  docker build -t "$REGISTRY/caprae-$app:$TAG" -t "$REGISTRY/caprae-$app:latest" "./$dir"
  docker push --all-tags "$REGISTRY/caprae-$app"
done
echo "Pushed caprae-api and caprae-web tagged $TAG"
