# FLAM QueueCTL

A minimal, production-grade background job queue with a clean CLI interface, workers, retries with exponential backoff, and a Dead Letter Queue (DLQ). Jobs are persisted using SQLite (via better-sqlite3) so they survive restarts. Cross-platform and self-contained.

## Features

- Enqueue and manage background jobs via `queuectl`
- Multiple worker processes with safe claiming to avoid duplicate processing
- Automatic retries with exponential backoff (base^attempts)
- Dead Letter Queue after exhausting retries
- Persistent job store (SQLite in `~/.queuectl/queue.db`, overridable via `QUEUECTL_HOME`)
- Graceful shutdown for workers (finish current job before exit)
- Configuration via CLI: `max_retries`, `backoff_base`, `poll_interval_ms`, `job_timeout_ms`
- Job logs written to `~/.queuectl/logs/job-<id>.log`
- Optional: scheduling (`run_at`), priority, and per-job max_retries override

## Setup

Prerequisites: Node.js 18+

```pwsh
# Install deps
npm ci

# Link the CLI locally (optional)
npm link
# Now `queuectl` is on your PATH (or use `node bin/queuectl.js`)
```

## Usage Examples

Enqueue a job (JSON input or raw string):

```pwsh
queuectl enqueue '{"command":"echo hello"}'
# or without JSON quoting issues
queuectl enqueue "echo hello"
```

Start/stop workers:

```pwsh
queuectl worker start --count 2
queuectl worker stop
```

Status and listing:

```pwsh
queuectl status            # includes DLQ as counts.dead
queuectl list --state pending
queuectl list --state dead # shows DLQ items
queuectl dlq list
```

Retry from DLQ:

```pwsh
queuectl dlq retry <jobId>
```

Configuration:

```pwsh
queuectl config set max_retries 3
queuectl config set backoff_base 2
queuectl config set poll_interval_ms 500
queuectl config set job_timeout_ms 10000  # 10s timeout per job (0 disables)
queuectl config get max_retries
```

Scheduling and priority:

```pwsh
queuectl enqueue '{"command":"echo later","run_at":"2025-11-04T10:30:00Z","priority":10}'
```

## Architecture Overview

- Storage: SQLite database with tables `jobs`, `dlq`, `workers`, and `config` in `~/.queuectl` (or `QUEUECTL_HOME`). WAL mode enabled for safe concurrency.
- Job lifecycle:
  - pending → processing → completed
  - On failure: attempts += 1; if attempts > max_retries → move to DLQ, else reschedule with delay = backoff_base^attempts seconds.
- Workers: separate Node processes. Each loop:
  - Heartbeat into `workers`
  - Claim next eligible job in a transaction (ordered by priority desc, created_at asc)
  - Execute with execa `shell: true` and optional timeout
  - Write combined stdout/stderr to a per-job log file
  - Update job state, reschedule, or move to DLQ
- Graceful shutdown: SIGTERM/SIGINT toggles a stopping flag; worker exits after finishing current job.

## Assumptions & Trade-offs

- Shell execution is via the platform default shell (execa `shell: true`). For cross-platform behavior, prefer `node -e` commands or simple built-ins.
- DLQ retry re-enqueues the original job as-is. If the command still fails, it will re-enter DLQ. You can change command or max_retries before retry if desired.
- A single SQLite file is sufficient for local/dev scale; for larger deployments, consider a server DB and supervision for worker processes.

## Testing

Quick run of included tests:

```pwsh
npm test
```

The tests cover:
- Basic success path (enqueue → complete)
- Configuration get/set
- Failed job moves to DLQ when `max_retries=0`
- Retrying a DLQ job re-enqueues and returns to DLQ if it still fails

You can also try the demo (uses a couple of illustrative jobs):

```pwsh
npm run demo
```

## Data Locations

- Home: `%USERPROFILE%/.queuectl` on Windows, `~/.queuectl` elsewhere (override with `QUEUECTL_HOME`)
- Database: `queue.db`
- Logs: `logs/job-<id>.log`
- Worker PIDs: `pids.json`

## CLI Help

```pwsh
queuectl --help
queuectl worker --help
queuectl dlq --help
queuectl config --help
```

## Minimal Contract and Edge Cases

- Input: job object with `command` (required); optional `id`, `max_retries`, `run_at`, `priority`.
- Output: job id on enqueue; JSON for status/list/dlq commands.
- Edge cases handled:
  - Invalid command or non-zero exit → retries with backoff
  - `max_retries=0` → immediate DLQ
  - Concurrent workers safely claim one job using a transaction
  - Graceful shutdown between jobs
  - Optional job timeout via `job_timeout_ms`

## Docker Usage

Build the image locally:

```pwsh
docker build -t flam-queuectl:latest .
```

Run a one-off enqueue using the image (mount a persistent volume for DB/logs):

```pwsh
docker run --rm -v queuectl-data:/data flam-queuectl:latest enqueue "echo from container"
```

Start a foreground worker (keeps container alive):

```pwsh
docker run --name queue-worker -v queuectl-data:/data flam-queuectl:latest worker run --poll-interval 500
```

Check status while worker runs:

```pwsh
docker run --rm -v queuectl-data:/data flam-queuectl:latest status
```

Stop and remove worker container:

```pwsh
docker stop queue-worker && docker rm queue-worker
```

### docker-compose

```pwsh
docker compose up -d --build
# scale workers
docker compose up -d --scale queuectl=3
```

Compose file starts each replica as a foreground worker (`worker run`). All share the named volume `queuectl-data` for persistence.

### Environment Overrides

Set `QUEUECTL_HOME=/data` (already in Dockerfile) so SQLite DB and logs persist in the mounted volume.

### Image Notes

- Based on `node:20-bookworm-slim` for reliable native module support (better-sqlite3).
- Production dependencies only (dev omitted) for smaller image.
- Use `worker run` in containers rather than `worker start` (which forks detached processes not ideal for container supervision).

### Health / Readiness (Optional)

You can define a healthcheck by polling `status`:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node bin/queuectl.js status >/dev/null 2>&1 || exit 1
```

Add that snippet to the Dockerfile if container orchestration requires it.

## Demo Recording

A scripted end-to-end demo is provided at `scripts/record-demo.ps1`.

Steps to record (PowerShell):

```pwsh
# Start your screen recorder
pwsh -File scripts/record-demo.ps1
```

The script shows help, enqueues jobs (success, failing, delayed), starts workers, displays status, logs, DLQ operations, config changes, and graceful shutdown.

After recording, upload the video (e.g., to Google Drive) and replace this placeholder link:

Demo video: https://drive.google.com/file/d/10z1xO1yf8XbzmoDrcRgRptvAdG6pYrNj/view?usp=drive_link

Feel free to shorten the waiting times in the script for a faster demo.
