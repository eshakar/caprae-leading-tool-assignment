# Deploying SaaSquatch Pro to AWS

Both apps ship as Docker images. The API runs its own migrations on boot (`scripts/start.sh`), and the web app reads
`API_URL` at **runtime**, so you build each image once and promote the same image through every environment.

There are two paths:

- **Path A: AWS App Runner.** The fastest, with no load balancer or cluster to manage. Good for demos and small teams.
- **Path B: ECS Fargate + ALB.** The production path: the API stays private and you get full control.

Both use **RDS PostgreSQL**, **ECR** and **Secrets Manager**.

> Replace `us-east-1`, `123456789012` and the passwords with your own values. Commands assume AWS CLI v2 and Docker.

---

## 0. Shared setup

### 0.1 Push the images to ECR
```bash
export AWS_REGION=us-east-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export REGISTRY=$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

aws ecr create-repository --repository-name caprae-api --region $AWS_REGION
aws ecr create-repository --repository-name caprae-web --region $AWS_REGION
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $REGISTRY

# Fargate/App Runner run x86_64 by default; build for that platform even from an ARM Mac.
docker build --platform linux/amd64 -t $REGISTRY/caprae-api:latest ./fastapi-caprae
docker build --platform linux/amd64 -t $REGISTRY/caprae-web:latest ./nextjs-caprae
docker push $REGISTRY/caprae-api:latest
docker push $REGISTRY/caprae-web:latest
```

### 0.2 Create the database (RDS PostgreSQL 17)
Console: **RDS → Create database → PostgreSQL 17 → Templates: Free tier / Production**.
- DB instance identifier `caprae-db`, master username `caprae`, a strong password
- Instance class `db.t4g.micro` (demo) or `db.t4g.medium`+ with **Multi-AZ** (production)
- **Public access: No.** Put it in the default VPC (or your own private subnets)
- Initial database name: `caprae`
- Security group `caprae-db-sg`: inbound **5432** only from the API's security group / VPC connector (set in A3/B2)

`pg_trgm` (used for fast search) is available on RDS and is created automatically by the first migration.

### 0.3 Store secrets
```bash
aws secretsmanager create-secret --name caprae/DATABASE_URL \
  --secret-string 'postgresql+psycopg://caprae:<PASSWORD>@<RDS-ENDPOINT>:5432/caprae'
aws secretsmanager create-secret --name caprae/ANTHROPIC_API_KEY --secret-string 'sk-ant-...'   # optional
```

---

## Path A: App Runner

### A1. API service
App Runner → **Create service** → Container registry → Amazon ECR → `caprae-api:latest`
- Deployment trigger: **Automatic** (redeploys on every push to `latest`)
- Port **8000**, CPU 1 vCPU / 2 GB
- Environment variables:
  - `DATABASE_URL` → *Secrets Manager* reference `caprae/DATABASE_URL`
  - `ANTHROPIC_API_KEY` → *Secrets Manager* reference `caprae/ANTHROPIC_API_KEY` (optional)
  - `WEB_CONCURRENCY=2`, `SEED_SAMPLE_DATA=true` (set to `false` for a clean production DB)
- Health check: **HTTP**, path `/api/health`
- **Networking → Outgoing traffic: Custom VPC** → create a **VPC connector** in the RDS VPC's private subnets with
  security group `caprae-apprunner-sg`. Allow that group in `caprae-db-sg` on port 5432.
  > A VPC connector routes *all* outbound traffic through your VPC. The crawler and Claude need internet access,
  > so the subnets must have a route to a **NAT gateway**.
- Instance role: needs `secretsmanager:GetSecretValue` on the `caprae/*` secrets.

Copy the default domain, e.g. `https://abc123.us-east-1.awsapprunner.com`.

### A2. Web service
App Runner → Create service → ECR → `caprae-web:latest`
- Port **3000**, 1 vCPU / 2 GB
- Environment: `API_URL=https://abc123.us-east-1.awsapprunner.com` (the API URL from A1)
- Health check: HTTP `/`
- Networking: public, no VPC connector needed

Open the web service URL. To attach your own domain, use **Custom domains → Link domain** (App Runner issues the TLS
certificate).

### A3. Lock down (recommended)
Set the API service to **Incoming traffic: Private endpoint** and give the web service a VPC connector into the same VPC,
so only the web app can reach the API.

---

## Path B: ECS Fargate + Application Load Balancer

### B1. Cluster and logs
```bash
aws ecs create-cluster --cluster-name caprae
aws logs create-log-group --log-group-name /ecs/caprae-api
aws logs create-log-group --log-group-name /ecs/caprae-web
```

### B2. Security groups (in the VPC)
| SG | Inbound |
|---|---|
| `alb-sg` | 80/443 from `0.0.0.0/0` |
| `web-sg` | 3000 from `alb-sg` |
| `api-sg` | 8000 from `web-sg` |
| `caprae-db-sg` | 5432 from `api-sg` |

Tasks run in **private subnets** with a **NAT gateway** (the crawler and Claude need outbound internet).

### B3. Task definitions
`caprae-api` (Fargate, 0.5 vCPU / 1 GB, `awsvpc`):
```json
{
  "family": "caprae-api",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
  "containerDefinitions": [{
    "name": "api",
    "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/caprae-api:latest",
    "portMappings": [{ "containerPort": 8000 }],
    "environment": [
      { "name": "WEB_CONCURRENCY", "value": "2" },
      { "name": "SEED_SAMPLE_DATA", "value": "false" }
    ],
    "secrets": [
      { "name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:caprae/DATABASE_URL" },
      { "name": "ANTHROPIC_API_KEY", "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:caprae/ANTHROPIC_API_KEY" }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": { "awslogs-group": "/ecs/caprae-api", "awslogs-region": "us-east-1", "awslogs-stream-prefix": "api" }
    }
  }]
}
```
`caprae-web` is the same shape with image `caprae-web:latest`, port **3000**, log group `/ecs/caprae-web`, and
environment `API_URL=http://api.caprae.local:8000` (see B4). The execution role needs `secretsmanager:GetSecretValue`.

```bash
aws ecs register-task-definition --cli-input-json file://api-task.json
aws ecs register-task-definition --cli-input-json file://web-task.json
```

### B4. Services
1. **API service**: Fargate, private subnets, `api-sg`, no load balancer. Enable **ECS Service Connect** with
   namespace `caprae.local` and the client alias `api` on port 8000. The web tasks then reach it at
   `http://api.caprae.local:8000`, and the API is never exposed to the internet.
2. **ALB**: internet-facing, public subnets, `alb-sg`. HTTPS listener on 443 with an **ACM** certificate (plus a
   redirect from 80). Target group `web-tg`: type *IP*, port 3000, health check path `/`.
3. **Web service**: Fargate, private subnets, `web-sg`, attached to `web-tg`, Service Connect client in `caprae.local`.

Scale each service on CPU (target tracking at 60%). Because enrichment jobs are in-process background tasks, keep API
tasks at a minimum of 1 and give them `stopTimeout: 60` so in-flight jobs can finish during deploys.

### B5. Deploying updates
```bash
docker build --platform linux/amd64 -t $REGISTRY/caprae-api:latest ./fastapi-caprae && docker push $REGISTRY/caprae-api:latest
aws ecs update-service --cluster caprae --service caprae-api --force-new-deployment
```
Migrations run automatically at container start (`alembic upgrade head`) before uvicorn binds the port, so the ALB/ECS
health check only passes once the schema is current.

---

## Environment reference

| Service | Variable | Example | Notes |
|---|---|---|---|
| API | `DATABASE_URL` | `postgresql+psycopg://user:pw@host:5432/caprae` | `postgres://` URLs are normalised automatically |
| API | `ANTHROPIC_API_KEY` | `sk-ant-…` | Optional; without it the Copilot uses templates |
| API | `ANTHROPIC_MODEL` | `claude-opus-5-5` | |
| API | `CORS_ORIGINS` | `https://app.example.com` | Only needed if browsers call the API directly |
| API | `WEB_CONCURRENCY` | `2` | uvicorn worker processes |
| API | `SEED_SAMPLE_DATA` | `false` | Seeds 30 fictional demo leads into an empty DB |
| API | `CRAWLER_CONCURRENCY` / `CRAWLER_TIMEOUT_SECONDS` | `5` / `8` | Crawl tuning |
| API | `ENRICHMENT_CACHE_DAYS` | `7` | Re-crawl interval |
| API | `RESPECT_ROBOTS_TXT` | `true` | |
| API | `CRAWLER_PROXY_URL` | `http://user:pw@proxy:8080` | Optional rotating egress proxy |
| Web | `API_URL` | `http://api.caprae.local:8000` | Read at runtime by the `/api` proxy route |
| Web | `PORT` / `HOSTNAME` | `3000` / `0.0.0.0` | Set in the image |

## Estimated monthly cost (us-east-1, demo scale)
RDS `db.t4g.micro` ≈ $13 · 2 small Fargate tasks ≈ $18 · ALB ≈ $17 · NAT gateway ≈ $33 (the largest line; you can use
one NAT for the whole VPC) · App Runner path: ≈ $10–25 for two low-traffic services, plus NAT if you use a VPC connector.
