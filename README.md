# Job Processing Comparison

Benchmark PostgreSQL-based CRON polling against Redis-backed BullMQ queues for job processing, with PostgreSQL advisory locking, priority management, and worker crash recovery.

## Architecture

```
┌─────────────┐    POST /api/export     ┌────────────────┐
│   Client    │ ──────────────────────>  │   API Server   │
└─────────────┘                         │   (Express)    │
                                        │   :3000        │
                                        └────┬──────┬────┘
                                             │      │
                                type=CRON    │      │ type=QUEUE
                                ┌────────────┘      └───────────┐
                                ▼                              ▼
                    ┌───────────────────┐        ┌────────────────────────┐
                    │   Cron Worker     │        │    BullMQ Queue        │
                    │   (polls 10s)     │        │   ┌────────────────┐   │
                    │   sequential      │        │   │  exportQueue   │   │
                    │   advisory locks  │        │   └────────┬───────┘   │
                    └────────┬──────────┘        │            │           │
                             │                   │            ▼           │
                             │                   │  ┌────────────────┐   │
                             │                   │  │  Queue Worker  │   │
                             │                   │  │  concurrency 3 │   │
                             │                   │  │  max retries 3 │   │
                             ▼                   │  └────────┬───────┘   │
                    ┌───────────────────┐        └───────────┼───────────┘
                    │   PostgreSQL      │  <─────────────────┘
                    │   (Prisma ORM)    │
                    └───────────────────┘
```

- **Cron path**: Jobs are written to Postgres with `type=CRON`. The cron worker polls every 10s, processes PENDING jobs sequentially (one at a time), optionally acquiring PostgreSQL advisory locks for distributed safety.
- **Queue path**: Jobs are written to Postgres and enqueued in BullMQ (`exportQueue`). The queue worker processes up to 3 jobs concurrently, with retry logic (max 3 attempts, 20% simulated failure rate).

### Data Flow

1. Client submits a job via `POST /api/export` with `type: "CRON"` or `type: "QUEUE"`.
2. The API persists a `Job` row in PostgreSQL and (for QUEUE type) adds a BullMQ message to Redis.
3. **Cron worker**: polls Postgres every 10s for CRON/PENDING jobs, processes them sequentially, releases advisory lock.
4. **Queue worker**: pulls jobs from BullMQ, processes with concurrency 3, writes status/execution logs back to Postgres.
5. **Benchmark**: submits 100 jobs of each type, polls Postgres until `started_at` is set, calculates `submitted_at → started_at` latency (avg + p95) and throughput.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 22 |
| API | Express 5 |
| ORM | Prisma 6 |
| Database | PostgreSQL 16 |
| Queue | BullMQ |
| Cache/Queue Broker | Redis 7 |
| Queue Dashboard | BullBoard |
| Containerization | Docker Compose |

## Schema

### Job
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| user_id | String? | |
| type | CRON \| QUEUE | |
| priority | Int | Lower = higher priority (default 10) |
| status | PENDING \| ACTIVE \| DONE \| FAILED | |
| submitted_at | BigInt | Unix ms |
| started_at | BigInt? | Unix ms |
| completed_at | BigInt? | Unix ms |
| worker_id | String? | Which worker processed it |
| attempts | Int | Incremented per attempt |

### ExecutionLog
| Column | Type | Notes |
|--------|------|-------|
| id | Int | Auto-increment |
| worker_id | String | |
| executed_at | BigInt | Unix ms |
| jobId | UUID | FK → Job |

## Setup

### Prerequisites

- Node.js 22+
- Docker Desktop (for local Postgres/Redis, recommended)
- npm

### Environment

```bash
cp .env.example .env
# Edit if needed — defaults work with local Docker
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | API server port |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/job_processing` | Postgres connection |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `CRON_INTERVAL_MS` | `10000` | Cron polling interval |
| `ADVISORY_LOCKING_ENABLED` | `true` | Toggle pg advisory locks |

### Docker (recommended)

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f api cron-worker queue-worker

# Stop everything
docker compose down
```

This starts:
- `postgres` on `:5432`
- `redis` on `:6379`
- `api` on `:3000`
- `cron-worker`
- `queue-worker`

The `docker-entrypoint.sh` automatically runs `prisma migrate deploy` on container start.

### Local Development

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run generate

# Run migrations
npm run migrate

# Start services in separate terminals
npm run start:api       # API server on :3000
npm run start:cron      # Cron polling worker
npm run start:queue     # BullMQ queue worker
```

## API

### POST /api/export

Submit a job for processing.

```bash
curl -X POST http://localhost:3000/api/export \
  -H "Content-Type: application/json" \
  -d '{"type": "QUEUE", "priority": 5, "user_id": "alice"}'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"CRON"` \| `"QUEUE"` | Yes | Processing pathway |
| `priority` | `Int` | No | Lower = higher priority (default 10) |
| `user_id` | `String` | Yes | Who submitted the job |

**Response (201):**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "PENDING",
  "type": "QUEUE"
}
```

### GET /

Health check — returns `Server is running...`.

### GET /admin/queues

BullBoard dashboard to inspect queue state, retry failed jobs, etc.

## Workers

### Cron Worker (`src/workers/cron.worker.js`)

- Polls PostgreSQL every `CRON_INTERVAL_MS` (default 10s)
- Fetches `type='CRON'` AND `status='PENDING'` ordered by priority ASC
- Processes jobs **sequentially** (one at a time)
- **Advisory locking** (toggle via `ADVISORY_LOCKING_ENABLED`):
  - Converts job UUID to int32 → `pg_try_advisory_lock()` on the key
  - Multiple cron workers can coexist safely; only one acquires the lock
- Graceful shutdown on SIGTERM/SIGINT

### Queue Worker (`src/workers/queue.worker.js`)

- BullMQ worker on `exportQueue` with **concurrency 3**
- Simulates **20% random failure rate** (random throw)
- Max 3 retries with exponential backoff (5s / 10s / 20s via BullMQ defaults)
- On final failure, marks job as `FAILED` in PostgreSQL via `worker.on("failed")`
- Writes `started_at`, `completed_at`, `attempts`, and `ExecutionLog` rows

### Comparison

| Aspect | Cron | Queue |
|--------|------|-------|
| Trigger | Polling (10s interval) | Event-driven (Redis pub/sub) |
| Concurrency | Sequential | 3 concurrent workers |
| Failure handling | None (runs to completion) | Retry ×3, then FAILED |
| Latency | Depends on poll interval | Near-instant |
| Crash recovery | Advisory locks prevent double-processing | BullMQ auto-reassigns in-flight jobs |
| Dependencies | PostgreSQL only | PostgreSQL + Redis |

## Benchmark

```bash
npm run benchmark
```

This submits 100 CRON jobs + 100 QUEUE jobs, measures the latency from `submitted_at` → `started_at`, and writes results to `output/benchmarking.json`.

### Metric Details

- **Latency**: `started_at - submitted_at` (milliseconds)
- **Avg**: Mean latency across all jobs that entered ACTIVE status
- **P95**: 95th percentile latency (sorted ascending, index at ceil(0.95 × n) − 1)
- **Throughput**: `(completed count / wall-clock ms) × 60000` (jobs per minute)

### Sample Output

```json
{
  "cron_stats": {
    "avg_latency_ms": 1234.56,
    "p95_latency_ms": 5123.78,
    "total_throughput_jobs_per_min": 45.12
  },
  "queue_stats": {
    "avg_latency_ms": 345.67,
    "p95_latency_ms": 1890.23,
    "total_throughput_jobs_per_min": 120.50
  }
}
```

## Project Structure

```
├── prisma/
│   └── schema.prisma              # Database schema & migrations
├── src/
│   ├── benchmark/
│   │   └── benchmark.js           # Latency + throughput benchmark
│   ├── config/
│   │   ├── prisma.js              # Prisma client singleton
│   │   └── redis.js               # ioredis connection
│   ├── controllers/
│   │   ├── export.controller.js   # POST /api/export handler
│   │   └── job.controller.js      # Job endpoints
│   ├── queues/
│   │   └── export.queue.js        # BullMQ queue definition
│   ├── routes/
│   │   ├── export.routes.js       # Export route registration
│   │   └── job.routes.js          # Job route registration
│   ├── services/
│   │   ├── export.service.js      # Job creation + Queue.enqueue logic
│   │   └── job.service.js         # Job query logic
│   └── workers/
│       ├── cron.worker.js         # Polling-based cron processor
│       └── queue.worker.js        # BullMQ queue consumer
├── submission.json                # Evaluation metadata
├── Dockerfile                     # Node.js container
├── docker-compose.yml             # Multi-service orchestration
├── docker-entrypoint.sh           # Container init (auto-migrate)
└── .env.example                   # Environment template
```

## npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `start:api` | `node server.js` | Start API server on :3000 |
| `start:cron` | `node src/workers/cron.worker.js` | Start cron polling worker |
| `start:queue` | `node src/workers/queue.worker.js` | Start BullMQ queue worker |
| `benchmark` | `node src/benchmark/benchmark.js` | Run comparative benchmark |
| `migrate` | `npx prisma migrate deploy` | Apply pending migrations |
| `generate` | `npx prisma generate` | Regenerate Prisma client |
| `dev` | `nodemon server.js` | API with auto-reload |
