# Create Docker Deployment

The supported self-contained stack is `docker-compose.create.yml`.

## Configure

```bash
cd deploy
cp .env.example .env
```

Set at least:

```dotenv
POSTGRES_PASSWORD=change-me
JWT_SECRET=at-least-32-random-bytes
TOTP_ENCRYPTION_KEY=at-least-32-random-bytes
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me-too
SERVER_PORT=9898
```

## Start

```bash
docker compose -f docker-compose.create.yml up -d
```

The stack contains:

- `create`
- `create-postgres`
- `create-redis`

Only the application port is published. PostgreSQL and Redis stay on the
private Compose network.

## Verify

```bash
docker compose -f docker-compose.create.yml ps
curl -fsS http://localhost:9898/health
```

## Upgrade

```bash
docker compose -f docker-compose.create.yml pull create
docker compose -f docker-compose.create.yml up -d create
```

Back up `create-postgres-data` and `create-data` before upgrades that include
new migrations.

## Local Image

```bash
docker build -f Dockerfile -t create:local .
IMAGE=create:local docker compose -f docker-compose.create.yml up -d
```

See [CREATE_DEPLOY.md](CREATE_DEPLOY.md) for full deployment and verification
instructions.
