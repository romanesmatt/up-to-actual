# Azure Functions Deployment Guide

A complete record of how this project was deployed to Azure Functions as a serverless timer trigger. Written as a reference for future deployments and as a learning resource.

---

## What We Built

A Node.js app (`up-to-actual`) deployed as an **Azure Functions v4 timer trigger** that:
- Runs automatically every day at **2am Melbourne time** (DST-aware)
- Fetches settled transactions from Up Bank's REST API
- Imports them into a self-hosted Actual Budget instance
- Retries up to 4 times with exponential backoff (5min → 15min → 45min) if anything fails
- Costs effectively **$0/month** on the Consumption plan (1M free executions/month, we use ~30)

---

## Concepts

### What is Azure Functions?

Azure Functions is Microsoft's **serverless compute platform**. Instead of running a server 24/7, you upload your code and Azure runs it in response to a trigger. You only pay for the milliseconds your code actually runs.

For this project:
- **Trigger type**: Timer — fires on a cron schedule
- **Plan**: Consumption — scales to zero, pay-per-execution
- **Runtime**: Node.js 22 on Linux

### Key Azure Concepts Used

| Concept | What It Is | How We Used It |
|---------|-----------|----------------|
| **Resource Group** | A folder that organises related Azure resources | `up-to-actual_group` — holds everything |
| **Storage Account** | Blob/table/queue storage | Required by Functions for internal timer state and deployment artefacts |
| **Function App** | The serverless compute instance | Where our code runs |
| **Application Settings** | Encrypted environment variables | Where secrets live in production |
| **Application Insights** | Telemetry and logging service | Where execution logs appear after each run |
| **Consumption Plan** | Pay-per-execution hosting model | Free tier covers our usage entirely |
| **Extension Bundle** | Pre-packaged Azure trigger extensions | Required for timer trigger support |

### Why Not a Local Cron Job?

| Local Cron | Azure Functions |
|-----------|----------------|
| Mac must be awake at 2am | Runs in the cloud regardless |
| No monitoring or alerting | Application Insights built in |
| Manual log rotation | Logs managed automatically |
| Setup is throwaway work | Production-ready from day one |
| Costs $0 | Also costs $0 |

---

## Azure Resources Created

### 1. Resource Group
- **Name**: `up-to-actual_group`
- **Region**: Australia East
- **Purpose**: Logical container for all project resources

### 2. Storage Account
- **Name**: `uptoactual`
- **Region**: Australia East
- **Redundancy**: Locally-redundant storage (LRS) — cheapest, sufficient for internal use
- **Purpose**: Azure Functions requires this internally for timer state, distributed locks, and deployment packages. Not used directly by our code.
- **Note**: This must exist in the same region as the Function App. Creating it separately (before the Function App) is valid but you must then wire it in manually via `AzureWebJobsStorage`.

### 3. Function App
- **Name**: `up-to-actual`
- **Runtime**: Node.js 22 LTS
- **OS**: Linux
- **Plan**: Consumption (serverless)
- **Region**: Australia East
- **Application Insights**: Enabled (auto-provisioned)

---

## Code Changes Required

Deploying to Azure required small, targeted changes to the existing codebase. The core business logic was untouched.

### New Files

#### `src/functions/syncTimer.js`
The Azure Functions v4 timer trigger. A thin ~30-line wrapper around the existing sync logic:

```js
const { app } = require('@azure/functions');

app.timer('syncTimer', {
  schedule: '0 0 2 * * *',   // 2am Melbourne time (WEBSITE_TIME_ZONE handles DST)
  handler: async (timer, context) => {
    const { validateConfig } = require('../config');
    const { executeSyncAttempt } = require('../sync');
    // ... validate, run, notify
  },
  retry: {
    strategy: 'exponentialBackoff',
    maxRetryCount: 3,
    minimumInterval: 5 * 60 * 1000,   // 5 minutes (must be ms, not HH:MM:SS)
    maximumInterval: 45 * 60 * 1000,  // 45 minutes
  },
});
```

**Key lesson**: `minimumInterval` and `maximumInterval` must be **milliseconds** (numbers), not time strings like `'00:05:00'`. The v4 SDK throws a silent error if strings are passed, and the function simply fails to load with no clear error message until you run `func start` locally.

#### `src/sync.js`
Extracted `executeSyncAttempt()` from `index.js` into a shared module so both the CLI (`npm start`) and the Azure Function can use the same sync logic without duplication.

#### `host.json`
Azure Functions host configuration:

```json
{
  "version": "2.0",
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  },
  "functionTimeout": "00:10:00"
}
```

**Key lesson**: The `extensionBundle` field is **required** for the timer trigger extension to load. Without it, the host starts but reports 0 functions found.

#### `.funcignore`
Tells the `func` deployment tool what to exclude from the upload package (tests, README, `.env`, etc.).

#### `local.settings.json.example`
Template for local Azure Functions development (the real `local.settings.json` is gitignored).

### Modified Files

#### `src/config.js`
Changed `validateConfig()` from calling `process.exit(1)` to throwing an `Error`. This is necessary for serverless — calling `process.exit()` would kill the Azure Functions host process entirely. The CLI behaviour is preserved by wrapping the call in a try/catch in `index.js`.

#### `package.json`
- Added `@azure/functions` dependency
- Changed `"main"` to point to `src/functions/syncTimer.js` — the Azure Functions v4 runtime uses this to discover function registrations
- Added `engines` field documenting Node 18+ requirement

---

## Application Settings (Secrets)

In Azure, environment variables are set as **Application Settings** — they're encrypted at rest and injected at runtime just like a `.env` file, but managed by Azure.

### Required Settings

| Setting | Value | Notes |
|---------|-------|-------|
| `UP_API_TOKEN` | `up:yeah:...` | From developer.up.com.au |
| `ACTUAL_SERVER_URL` | `https://...pikapods.net` | Your Actual Budget instance URL |
| `ACTUAL_PASSWORD` | your password | Actual Budget login password |
| `ACTUAL_SYNC_ID` | UUID | From Actual: Settings → Advanced → Sync ID |
| `ACTUAL_ACCOUNT_ID` | UUID | Run `npm run test:actual` locally to find this |
| `ACTUAL_DATA_DIR` | `/tmp/actual-data` | Must be `/tmp/...` on Azure — the only writable directory on Consumption plan |
| `WEBSITE_TIME_ZONE` | `Australia/Melbourne` | Makes the cron schedule DST-aware automatically |
| `AzureWebJobsStorage` | connection string | Storage account connection string — required for timer state |
| `FUNCTIONS_WORKER_RUNTIME` | `node` | Tells Azure which worker to use |
| `FUNCTIONS_EXTENSION_VERSION` | `~4` | Locks to Functions runtime v4 |

### `ACTUAL_DATA_DIR` — Why `/tmp`?

The `@actual-app/api` package downloads your budget file to a local directory on every run. On Azure's Consumption plan, the filesystem is read-only **except for `/tmp`** (up to ~500MB of ephemeral storage).

Setting `ACTUAL_DATA_DIR=/tmp/actual-data` means:
- The budget data downloads to `/tmp/actual-data` on each invocation
- It gets wiped between cold starts — which is fine, it re-downloads fresh each time
- No storage costs, no stale data issues

### Setting Application Settings via CLI

```bash
az functionapp config appsettings set \
  --name up-to-actual \
  --resource-group up-to-actual_group \
  --settings \
    UP_API_TOKEN="your-token" \
    ACTUAL_SERVER_URL="https://your-instance.pikapods.net" \
    ACTUAL_PASSWORD="your-password" \
    ACTUAL_SYNC_ID="your-sync-id" \
    ACTUAL_ACCOUNT_ID="your-account-id" \
    ACTUAL_DATA_DIR="/tmp/actual-data" \
    WEBSITE_TIME_ZONE="Australia/Melbourne"
```

**Note**: The CLI output shows `"value": null` for all settings — this is **not an error**. Azure redacts secret values from CLI output as a security measure. Verify by checking the portal under **Settings → Environment variables**.

---

## Deployment

### Prerequisites

```bash
# Azure CLI
brew install azure-cli
az login

# Azure Functions Core Tools
npm install -g azure-functions-core-tools@4 --unsafe-perm true
```

### Deploy Command

```bash
func azure functionapp publish up-to-actual --javascript --build remote
```

**Flags explained**:
- `--javascript`: Tells `func` the project language (can't auto-detect in our repo layout)
- `--build remote`: Runs `npm install` on the Azure Linux host rather than uploading local `node_modules`. **Critical** for native dependencies like `better-sqlite3` (used by `@actual-app/api`) — the Mac-compiled binary won't run on Linux.

### What a Successful Deploy Looks Like

```
Remote build succeeded!
[2026-02-20T07:02:59.792Z] Syncing triggers...
Functions in up-to-actual:
    syncTimer - [timerTrigger]
```

The last two lines are the key signal. `syncTimer - [timerTrigger]` means the function is registered and the timer is active.

### What Went Wrong During Our Deployment (And Why)

We hit several issues during deployment that are worth documenting:

#### Issue 1: `Functions in up-to-actual:` (blank)
**Cause**: `extensionBundle` was missing from `host.json`. The runtime loaded but couldn't find the timer extension, so it loaded 0 functions silently.
**Fix**: Added the `extensionBundle` block to `host.json`.

#### Issue 2: Still blank after adding extensionBundle
**Cause**: `retry.minimumInterval` and `retry.maximumInterval` in `syncTimer.js` were set as time strings (`'00:05:00'`) instead of milliseconds (`300000`). The v4 SDK threw an error loading the file, but the error was completely silent in the deploy output.
**Diagnosis**: Running `func start` locally showed the exact error: `A 'number' or 'Duration' object was expected instead of a 'string'. Cannot parse value of 'retry.maximumInterval'.`
**Fix**: Changed both values to milliseconds: `5 * 60 * 1000` and `45 * 60 * 1000`.

**Key lesson**: Always run `func start` locally when a deploy succeeds but functions aren't detected. The local output shows the actual runtime error that the deploy process swallows.

#### Issue 3: Storage account not in resource group
**Cause**: The storage account created early in setup ended up not being linked to the Function App. Azure couldn't initialise properly without `AzureWebJobsStorage`.
**Fix**: Created a new storage account (`uptoactual`) in the correct resource group, retrieved its connection string, and set it as an Application Setting.

#### Issue 4: `AzureWebJobsStorage` CLI output showing `null`
**Cause**: This is by design — Azure CLI redacts secret values from `az functionapp config appsettings list` output. Not an error.
**Fix**: Verify values are set by checking the portal (Function App → Settings → Environment variables) where the actual values are visible.

---

## Monitoring

### Checking if the Function Ran

After 2am Melbourne time, check:

1. **Portal → Function App → Functions → syncTimer → Monitor**
   - Shows invocation history: timestamp, duration, success/failure
   - Click any invocation to see its full log output

2. **Portal → Application Insights → Transaction search**
   - Filter by time range
   - Shows all `logger.info()` / `logger.error()` output as structured traces

### What a Successful Invocation Log Looks Like

```json
{"level":"info","message":"Up-to-Actual sync triggered"}
{"level":"info","message":"Up Bank API authenticated successfully","statusEmoji":"⚡️"}
{"level":"info","message":"Fetching settled transactions from Up Bank","since":"...","windowHours":48}
{"level":"info","message":"Finished fetching transactions from Up Bank","totalTransactions":3}
{"level":"info","message":"Importing transactions into Actual Budget","count":3}
{"level":"info","message":"Import complete","added":3,"updated":0,"errors":0}
{"level":"info","message":"=== Sync completed successfully ===","added":3,"fetched":3,"durationMs":2341}
```

### What a Failed Invocation Looks Like

```json
{"level":"error","message":"Sync failed","error":"Up Bank API rate limited (HTTP 429)"}
```

Azure will automatically retry using the exponential backoff policy (5min → 15min → 45min).

---

## Redeploying After Code Changes

```bash
# 1. Make code changes locally
# 2. Run tests
npm test

# 3. Commit and push
git add .
git commit -m "your message"
git push origin main

# 4. Redeploy
func azure functionapp publish up-to-actual --javascript --build remote
```

---

## Timezone Reference

Australia uses two timezones depending on daylight saving:
- **AEST** (UTC+10): April to October (winter)
- **AEDT** (UTC+11): October to April (summer)

Setting `WEBSITE_TIME_ZONE=Australia/Melbourne` and using cron `0 0 2 * * *` means the function always runs at **2am Melbourne local time** regardless of the season. Azure handles the DST transition automatically.

Without this setting, you'd need to hardcode a UTC offset which would drift by an hour twice a year.

---

## Cost Breakdown

| Resource | Pricing Model | Our Usage | Estimated Cost |
|----------|--------------|-----------|----------------|
| Function App (Consumption) | 1M executions free/month | ~30/month | $0.00 |
| Execution time | 400,000 GB-s free/month | ~5s × 30 = 150s | $0.00 |
| Storage Account | ~$0.02/GB/month | <1MB timer state | ~$0.00 |
| Application Insights | 5GB free/month | <1MB logs | $0.00 |
| **Total** | | | **~$0.00/month** |

---

## Azure CLI Reference

Useful commands for managing this deployment:

```bash
# Check function app status
az functionapp show --name up-to-actual --resource-group up-to-actual_group

# List all application settings (values redacted)
az functionapp config appsettings list --name up-to-actual --resource-group up-to-actual_group

# Update a single setting
az functionapp config appsettings set --name up-to-actual --resource-group up-to-actual_group --settings KEY="value"

# Get storage account connection string
az storage account show-connection-string --name uptoactual --resource-group up-to-actual_group --query connectionString --output tsv

# List all resources in the resource group
az resource list --resource-group up-to-actual_group --output table

# Restart the function app
az functionapp restart --name up-to-actual --resource-group up-to-actual_group
```
