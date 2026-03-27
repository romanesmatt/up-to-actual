# Up to Actual

An automated transaction sync service that bridges [Up Bank](https://up.com.au/) (Australian neobank) and [Actual Budget](https://actualbudget.org/) (open-source budgeting software). Fetches transactions from Up's REST API and imports them into Actual Budget via its Node.js API on a scheduled basis.

Runs as a lightweight cron job — designed for a Raspberry Pi or any always-on Linux host.

## Why This Exists

Up Bank is an Australian neobank with an excellent [developer API](https://developer.up.com.au/). Actual Budget is an open-source, privacy-first budgeting tool. However, Actual Budget doesn't natively support bank feeds for Australian banks. This service acts as the intermediary layer — fetching transactions from Up and importing them into Actual Budget automatically.

## Architecture

### System Overview

```mermaid
flowchart TB
    subgraph Scheduler["⏰ Cron (daily at 2am)"]
        CRON["crontab\nnode src/index.js"]
    end

    subgraph Core["🔧 Sync Pipeline"]
        direction TB
        SYNC["executeSyncAttempt()\nsrc/sync.js"]
        RETRY["Exponential Backoff Retry\n(5min → 15min → 45min)"]
        SYNC --> RETRY
    end

    subgraph UpBank["🏦 Up Bank — upbank.js"]
        UP_API["Up REST API\nGET /transactions\n(Last 7 Days)"]
    end

    subgraph Transform["🔄 Transformer — transform.js"]
        MAP["Schema Mapping\nUp → Actual Format\n\n• description → payee_name\n• valueInBaseUnits → amount\n• createdAt → date\n• id → imported_id"]
    end

    subgraph ActualBudget["📒 Actual Budget — actual.js"]
        AB_API["Actual Node.js API\n@actual-app/api\n\n• importTransactions()\n• Built-in Deduplication"]
    end

    subgraph Secrets["🔐 Secrets — config.js"]
        ENV[".env via dotenv\n(Never committed to git)"]
    end

    subgraph Notify["📣 Notifications — notify.js"]
        WEBHOOK["Webhook Alerts\n(Ntfy / Discord / Pushover)\n\n✅ Sync Success Summary\n❌ Final Failure Alert"]
    end

    subgraph Logging["📝 Logging"]
        LOG["Structured JSON Logs\n→ stdout / log file\n\n• Transactions fetched\n• Transactions imported\n• Errors encountered\n• Duplicates skipped"]
    end

    CRON -->|"Triggers at 2:00am"| SYNC
    SYNC -->|"1. Fetch Transactions"| UP_API
    UP_API -->|"JSON Response"| MAP
    MAP -->|"Transformed Transactions"| AB_API
    AB_API -->|"Import Result"| SYNC
    SYNC -->|"On Success / Failure"| WEBHOOK
    SYNC -->|"Every Run"| LOG
    RETRY -->|"On Failure"| UP_API
    Secrets -.->|"Credentials"| UP_API
    Secrets -.->|"Credentials"| AB_API
```

### Sync Flow (Per Execution)

```mermaid
sequenceDiagram
    participant Cron as ⏰ Cron
    participant Sync as 🔧 Sync Pipeline
    participant Config as 🔐 Config
    participant Up as 🏦 Up Bank API
    participant Trans as 🔄 Transformer
    participant AB as 📒 Actual Budget
    participant Notify as 📣 Webhook
    participant Log as 📝 Logger

    Cron->>Sync: Trigger sync
    Sync->>Config: Validate secrets (Up token, AB credentials)
    Config-->>Sync: Credentials validated

    Sync->>Up: GET /transactions?filter[since]=7d ago
    alt API Available
        Up-->>Sync: 200 OK — Transaction data (JSON)
        Sync->>Trans: Transform Up → Actual schema
        Trans-->>Sync: Transformed transactions
        Sync->>AB: api.importTransactions(accountId, transactions)
        AB-->>Sync: Import result (created, skipped duplicates)
        Sync->>Log: Log success (count, duplicates, duration)
        Sync->>Notify: ✅ Sync complete — X new, Y skipped
    else API Unavailable (5xx / Timeout)
        Up-->>Sync: Error
        Sync->>Log: Log failure (attempt 1)
        loop Retry (Max 4 Attempts, Exponential Backoff)
            Note over Sync,Up: Wait 5m → 15m → 45m
            Sync->>Up: Retry GET /transactions
        end
        Sync->>Log: Log final failure
        Sync->>Notify: ❌ Sync failed after 4 attempts
    end
```

### Retry Strategy

```mermaid
flowchart LR
    A["Attempt 1\n2:00am"] -->|"Fail → Wait 5m"| B["Attempt 2\n2:05am"]
    B -->|"Fail → Wait 15m"| C["Attempt 3\n2:20am"]
    C -->|"Fail → Wait 45m"| D["Attempt 4\n3:05am"]
    D -->|"Fail"| E["❌ Alert via Webhook\nSkip until next day"]
    E -.->|"7-day window ensures\nno data loss"| F["Next day's sync\npicks up everything"]

    style E fill:#ff6b6b,color:#fff
    style F fill:#51cf66,color:#fff
```

## Transaction Mapping

| Up Bank Field | Actual Budget Field | Notes |
|---|---|---|
| `id` | `imported_id` | Used for deduplication across syncs |
| `attributes.description` | `payee_name` | Matched against AB's payee rules |
| `attributes.amount.valueInBaseUnits` | `amount` | Integer cents — used directly (no float conversion) |
| `attributes.createdAt` | `date` | ISO 8601 → YYYY-MM-DD |
| `attributes.message` | `notes` | Optional; transfer memo or message |
| — | `cleared` | Always `true` (only SETTLED transactions are imported) |

## Project Structure

```
up-to-actual/
├── src/
│   ├── index.js              # Entry point — retry logic, signal handling
│   ├── sync.js               # Core sync logic
│   ├── upbank.js             # Up Bank API client — fetch transactions
│   ├── actual.js             # Actual Budget API client — import transactions
│   ├── transform.js          # Schema mapping — Up → Actual format
│   ├── config.js             # Secret loading — env vars via dotenv
│   ├── backoff.js            # Exponential backoff calculation
│   ├── logger.js             # Structured JSON logging
│   ├── notify.js             # Webhook notifications — success/failure alerts
│   ├── healthcheck.js        # Connectivity check (for Uptime Kuma)
│   ├── test-up.js            # Test script: verify Up Bank API token
│   ├── test-actual.js        # Test script: list Actual accounts (find account ID)
│   └── __tests__/            # Unit test suite (node:test runner)
│       ├── helpers/
│       │   └── fixtures.js   # Shared test utilities and factories
│       ├── transform.test.js
│       ├── backoff.test.js
│       ├── config.test.js
│       ├── logger.test.js
│       ├── notify.test.js
│       ├── upbank.test.js
│       └── actual.test.js
├── crontab.example           # Cron schedule reference
├── .env.example              # Template for environment variables
├── .gitignore
├── package.json
├── LICENSE
└── README.md
```

## Prerequisites

- **Node.js** >= 18.x (uses native `fetch`)
- **An Up Bank account** with a [Personal Access Token](https://api.up.com.au)
- **An Actual Budget instance** (self-hosted or [PikaPods](https://www.pikapods.com/pods?run=actual))
- Your Actual Budget **Sync ID** (Settings → Show advanced settings → Sync ID)

## Environment Variables

Create a `.env` file from the template:

```bash
cp .env.example .env
```

| Variable | Description | Required |
|---|---|---|
| `UP_API_TOKEN` | Up Bank Personal Access Token (Bearer token) | ✅ |
| `ACTUAL_SERVER_URL` | URL of your Actual Budget server | ✅ |
| `ACTUAL_PASSWORD` | Password for your Actual Budget instance | ✅ |
| `ACTUAL_SYNC_ID` | Budget file Sync ID from Actual settings | ✅ |
| `ACTUAL_ACCOUNT_ID` | Account ID in Actual to import transactions into | ✅ |
| `ACTUAL_E2E_PASSWORD` | End-to-end encryption password (if enabled) | ❌ |
| `ACTUAL_DATA_DIR` | Local data cache directory (default: `./actual-data`) | ❌ |
| `WEBHOOK_URL` | Notification webhook URL (Ntfy / Discord / Pushover) | ❌ |
| `SYNC_WINDOW_HOURS` | Hours of transaction history to fetch (default: 168 / 7 days) | ❌ |
| `MAX_RETRIES` | Maximum retry attempts on failure (default: 4) | ❌ |
| `LOG_LEVEL` | Logging verbosity: debug, info, warn, error (default: info) | ❌ |

> **Security**: Never commit `.env` files. It is excluded via `.gitignore`.

## Usage

### Setup

```bash
# Install dependencies
npm install

# Run tests
npm test

# Verify API connections
npm run test:up       # Check Up Bank token
npm run test:actual   # List Actual Budget accounts

# Run sync manually
npm start

# Run health check
npm run healthcheck
```

### Cron Deployment (Raspberry Pi)

1. Clone the repo and install dependencies:
   ```bash
   sudo mkdir -p /opt/up-to-actual
   sudo chown $USER:$USER /opt/up-to-actual
   git clone https://github.com/romanesmatt/up-to-actual.git /opt/up-to-actual
   cd /opt/up-to-actual
   npm install --production
   cp .env.example .env
   # Edit .env with your credentials
   ```

2. Set timezone (if not already Melbourne):
   ```bash
   sudo timedatectl set-timezone Australia/Melbourne
   ```

3. Create log directory:
   ```bash
   sudo mkdir -p /var/log/up-to-actual
   sudo chown $USER:$USER /var/log/up-to-actual
   ```

4. Install the cron job:
   ```bash
   # View the example schedule
   cat crontab.example

   # Add to your crontab (runs daily at 2am)
   crontab -e
   # Paste: 0 2 * * * cd /opt/up-to-actual && /usr/bin/node src/index.js >> /var/log/up-to-actual/sync.log 2>&1
   ```

5. Verify it's installed:
   ```bash
   crontab -l
   ```

### Monitoring with Uptime Kuma

The health check script (`npm run healthcheck`) validates connectivity to both APIs. Configure an Uptime Kuma "Push" monitor and chain it with the health check cron:

```bash
0 */6 * * * cd /opt/up-to-actual && /usr/bin/node src/healthcheck.js && curl -fsS -o /dev/null https://kuma.local/api/push/xxxxx
```

See `crontab.example` for the full setup including log rotation.

## Testing

Unit tests using Node's built-in test runner (`node:test`). Zero test dependencies.

```bash
npm test                                    # Run full suite
node --test src/__tests__/transform.test.js # Run single file
```

| Module | Tests | What's Covered |
|--------|-------|----------------|
| `transform` | 13 | Date extraction, field mapping, batch transform |
| `backoff` | 4 | Delay formula verification |
| `config` | 12 | Validation, defaults, parsing, immutability |
| `logger` | 10 | Level filtering, JSON format, stream routing |
| `notify` | 10 | Discord detection, webhook calls, error resilience |
| `upbank` | 10 | Ping, pagination, rate limiting, error handling |
| `actual` | 10 | Connect, import, disconnect, E2E encryption |

## Design Decisions

### Why a 7-Day Rolling Window?

Rather than tracking a precise "last sync" timestamp, this service fetches the last 7 days of settled transactions on every run. This is an idempotent data pipeline pattern:

- **Resilience**: If a sync fails entirely, the next day's run picks up everything — no data gaps.
- **Stateless**: No sync timestamp file to corrupt, lose, or get out of sync.
- **Safe**: Actual Budget's `importTransactions()` deduplicates via `imported_id`, so overlapping fetches don't create duplicate entries.

The tradeoff is marginally more API calls, which is negligible for a single spending account.

### Why `importTransactions` over `addTransactions`?

Actual Budget's API offers both methods. `importTransactions` runs the reconciliation engine — matching against existing transactions and deduplicating via `imported_id`. `addTransactions` is for raw data dumps with no deduplication. Since we're syncing incrementally with overlap, deduplication is essential.

### Why a Cron Job?

- **Cost**: $0 — runs on existing hardware
- **Simplicity**: No cloud services, no vendor lock-in, no billing surprises
- **Privacy**: All data stays on your local network
- **Reliability**: Exponential backoff retry handles transient API failures; 7-day window ensures no data loss across missed runs

## Future Roadmap

- [x] **v1.0** — Core sync: Up → Actual via CLI
- [x] **v1.1** — Unit test suite (69 tests)
- [x] **v1.2** — Cron deployment with health checks
- [ ] **v1.3** — Multi-account support (spending + savings)
- [ ] **v2.0** — Real-time sync via Up Bank webhooks

## Related Projects

- [up-to-ynab](https://github.com/BrodieSutherland/up-to-ynab) — Automatic transaction forwarder from Up to YNAB (Python, Heroku)
- [Actual Budget API Docs](https://actualbudget.org/docs/api/)
- [Up Bank API Docs](https://developer.up.com.au/)
- [Up Bank API Community Projects](https://github.com/up-banking/api/blob/master/community/EXAMPLES.md)

## Contributing

This project was built for personal use, but contributions are welcome. If you're an Australian Up Bank customer using Actual Budget, feel free to open an issue or submit a pull request.

## Licence

[MIT](./LICENSE)
