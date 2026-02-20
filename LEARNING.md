# Learning Journal: up-to-actual

A personal record of building and deploying this project — written as both a reflection on the journey and a technical reference I can return to. February 2026.

---

## Part 1 — Personal Reflection

### Why This Project Exists

I moved from YNAB to Actual Budget earlier this year. YNAB had a native Up Bank integration — you set it up once and transactions appeared. Actual Budget doesn't. It's open-source and self-hosted, which I love, but it means you're responsible for getting your data in.

Up Bank has a genuinely excellent developer API. It's well-documented, token-based, and free. So the problem was clear: write something that calls the Up API, transforms the response into Actual's schema, and imports it. Not complicated in concept, but there were a lot of moving parts to get right.

The original goal was a local cron job on my Mac. But when I thought it through — my Mac needs to be awake at 2am, there's no monitoring, if it fails silently I'd have no idea — it stopped being appealing. Azure Functions was always the intended destination. I just wanted the core sync logic proven before going near the cloud.

### What I Already Knew vs What Was New

I have a Microsoft background. Azure as a platform wasn't foreign to me conceptually — I'd worked with it in enterprise contexts. But Azure Functions specifically, and the serverless-first pattern, was new territory. I'd never deployed a timer trigger from scratch, never touched the Azure Functions Core Tools, never dealt with the v4 Node.js programming model.

The concepts I was comfortable with: resource groups, subscriptions, storage accounts, the portal. The concepts I had to actually learn by doing: how Functions discovers your code, what `extensionBundle` does, why `--build remote` matters for Node.js native modules, how Application Settings differ from a `.env` file, and the nuances of the v4 SDK.

### The Journey

The sync logic itself came together cleanly. Fetching from the Up API, transforming the schema, importing into Actual with deduplication via `imported_id` — that was the part that felt familiar. Write the code, write the tests (69 of them, zero external dependencies), verify it works end-to-end with `npm start`. That part was satisfying.

The Azure deployment was where I learned the most — mostly through things not working.

### What Went Wrong (And What I Actually Learned)

#### Issue 1: `Functions in up-to-actual:` — completely blank

After the first successful deploy, the output showed my function app name but nothing underneath it. No functions detected. Deploy succeeded, no error messages, just silence.

The cause was that `extensionBundle` was missing from `host.json`. The Azure Functions host loaded fine — it just had no extension to handle the timer trigger type, so it found zero functions and reported zero functions. Completely silent failure.

The fix was adding the `extensionBundle` block to `host.json`. But the lesson was more important than the fix: **when a deploy succeeds but functions aren't listed, run `func start` locally**. The local runtime outputs the actual error. The deploy process swallows it. I never would have found the real cause by staring at the deploy output.

#### Issue 2: Still blank after fixing extensionBundle

Same symptom, different cause. In `syncTimer.js`, the retry configuration had:

```js
minimumInterval: '00:05:00',
maximumInterval: '00:45:00',
```

Looks reasonable. Azure Functions uses time strings everywhere else. But the v4 SDK expects milliseconds as numbers, not strings. It threw an error when loading the file and the function simply didn't register — again, completely silently in the deploy output.

Running `func start` locally immediately showed: `A 'number' or 'Duration' object was expected instead of a 'string'. Cannot parse value of 'retry.maximumInterval'.`

Fixed by changing to `5 * 60 * 1000` and `45 * 60 * 1000`. Obvious in retrospect. The lesson was the same as Issue 1, reinforced: **the local runtime is your debugger for silent deploy failures**.

#### Issue 3: Storage account and AzureWebJobsStorage

Early in the setup I'd created a storage account in the portal, but it wasn't properly wired to the Function App. Azure Functions requires a storage account connection string in `AzureWebJobsStorage` — it uses blob storage internally for timer state and distributed locks.

When I ran `az functionapp config appsettings list`, every setting showed `"value": null`. I thought something was badly wrong. It turned out: **Azure CLI redacts secret values from list output as a security measure**. The values were there — verifying in the portal (Settings → Environment variables) showed the actual values.

The storage account fix required creating a new one (`uptoactual`) in the correct resource group, getting its connection string via:

```bash
az storage account show-connection-string \
  --name uptoactual \
  --resource-group up-to-actual_group \
  --query connectionString --output tsv
```

And setting it as an Application Setting. After that, everything locked in.

#### Issue 4: Function ran at 10am, not 2am

After the second successful deploy (the one that actually listed the function), I was watching for a run at 2am the next morning. Instead it ran at around 10am the same day.

This is `isPastDue` behaviour. When the Azure Functions host starts, it checks whether any scheduled runs were missed. The 2am schedule had already passed for the day. So on startup, it fired the function immediately with `timer.isPastDue = true` as a catch-up run.

This is **expected and correct**. It's not an error. It means you never miss a run due to a restart or redeployment. Once I understood it, it made complete sense — but it was confusing in the moment because I expected the first run to be the next day's 2am.

### What This Means Professionally

Going into this, I could say I had general Azure experience. Coming out of it, I can say something more specific and credible:

- I've deployed a production Node.js workload to Azure Functions using the v4 programming model
- I understand the Consumption plan model and its constraints (read-only filesystem, `/tmp` for writes, cold starts)
- I've handled native binary deployment (`better-sqlite3` via `--build remote`)
- I've configured Application Insights and know where to look for logs
- I've debugged silent runtime failures using `func start` locally
- I've configured DST-aware scheduled execution via `WEBSITE_TIME_ZONE`
- I understand the resource hierarchy (subscription → resource group → storage account + function app) from first principles

These are things you can only say credibly if you've actually done them. Now I have.

---

## Part 2 — Technical Reference

Concepts I encountered, explained in plain English for future reference.

### Serverless / Azure Functions in Plain Terms

Traditional hosting: you rent a server (or VM), it runs 24/7, you pay for it 24/7 whether you use it or not.

Serverless: you upload code. The platform runs it when something triggers it. You pay for the milliseconds it actually runs. When nothing is happening, there's no server — it scales to zero.

For a daily cron job that takes 5 seconds, the difference is enormous. A server costs $10–50/month. Azure Functions on the Consumption plan gives you 1 million free executions per month. We use about 30. Cost: $0.00.

The tradeoff is "cold starts" — the first invocation after a period of inactivity takes slightly longer because Azure has to provision the runtime. For a daily sync, this is irrelevant.

### Azure Resource Hierarchy

```
Azure Account
└── Subscription (billing unit)
    └── Resource Group (logical folder)
        ├── Storage Account
        ├── Function App
        └── Application Insights
```

Everything lives inside a Resource Group. Deleting a Resource Group deletes everything in it. For this project: `up-to-actual_group` in Australia East.

### Consumption Plan vs Other Plans

| Plan | Cold Starts | Scale | Cost |
|------|------------|-------|------|
| Consumption | Yes (first run after idle) | Automatic, to zero | Pay per execution |
| Premium | No (always warm) | Automatic, min 1 instance | ~$150+/month |
| App Service | No | Manual or rule-based | Fixed monthly |

For a daily 5-second job, Consumption is the right choice. Cold start of a second or two doesn't matter.

### Timer Triggers and 6-Part Cron Syntax

Azure Functions uses a 6-part cron expression: `{second} {minute} {hour} {day} {month} {weekday}`

`0 0 2 * * *` means: at second 0, minute 0, hour 2, every day, every month, every weekday. i.e., 2:00:00am every day.

Standard Unix cron is 5-part (no seconds field). Azure adds the seconds field at the front.

### Application Settings vs `.env` Files

Locally, you put secrets in a `.env` file and `dotenv` loads them into `process.env`. In Azure, you set **Application Settings** — they're injected into `process.env` at runtime, encrypted at rest, and managed by Azure. Same result, different mechanism.

The key difference: Azure CLI redacts secret values from output. When you run `az functionapp config appsettings list`, every value shows as `null`. This is by design — Azure doesn't want secrets leaking into terminal logs or CI pipelines. The actual values are visible in the portal under Settings → Environment variables.

To verify a setting is saved, always check the portal. The CLI output of `null` is not an error.

### `WEBSITE_TIME_ZONE` and DST Handling

Australia uses:
- **AEST** (UTC+10): April to October (winter)
- **AEDT** (UTC+11): October to April (summer)

If you hardcode a UTC offset in your cron schedule, you'd need to update it twice a year. Instead, set:

```
WEBSITE_TIME_ZONE = Australia/Melbourne
```

Now your cron (`0 0 2 * * *`) is interpreted in Melbourne local time. Azure handles the DST transition automatically. The function always runs at 2am Melbourne time, regardless of the time of year.

### `--build remote` and Why Native Binaries Matter

```bash
func azure functionapp publish up-to-actual --javascript --build remote
```

The `--build remote` flag tells Azure to run `npm install` on the Azure Linux host instead of uploading your local `node_modules`.

Why this matters: `@actual-app/api` depends on `better-sqlite3`, which includes a **native C++ addon** that gets compiled for your specific platform and architecture. If you develop on a Mac (arm64) and deploy the `node_modules` directly, the compiled binary is for macOS — it won't run on Linux x64.

`--build remote` solves this by compiling `better-sqlite3` on the same platform it will run on. Always use it for any project with native dependencies.

### `extensionBundle` — What It Is and Why It's Required

Azure Functions supports many trigger types: HTTP, timer, Service Bus, Cosmos DB, etc. Each trigger type is implemented as an extension.

`extensionBundle` is a pre-packaged collection of these extensions. Without it, the host has no way to handle a timer trigger — it loads, but finds zero functions and registers zero functions. The failure is completely silent in deploy output.

```json
"extensionBundle": {
  "id": "Microsoft.Azure.Functions.ExtensionBundle",
  "version": "[4.*, 5.0.0)"
}
```

This goes in `host.json`. It must be present for the timer trigger to work. Without it, you'll see `Functions in <app-name>:` with nothing underneath.

### `isPastDue` — What It Means and When It Fires

When the Azure Functions host starts up, it checks the timer schedule against the current time. If a scheduled invocation was missed while the host was down (e.g., during a deployment or restart), it immediately fires the function with `timer.isPastDue = true`.

This is a catch-up mechanism. It guarantees no scheduled runs are silently skipped due to host restarts.

Practical implication: if you deploy at 10am and your schedule is 2am, the function will fire immediately on first startup. This is **expected, correct behaviour** — not an error. The `isPastDue` flag tells you why it fired outside the schedule.

### Application Insights — Where Logs Live

Application Insights is Azure's telemetry platform. It captures:
- Every function invocation (timestamp, duration, success/failure)
- All log output (`context.log()`, `console.log()`, etc.)
- Exceptions with stack traces
- Custom structured properties

To check if the function ran: **Function App → Functions → syncTimer → Monitor**. This shows invocation history. Click any row to see the full log output for that run.

Logs appear in Application Insights with a delay of 2–5 minutes. Don't expect real-time output.

### Key Azure CLI Commands

```bash
# Check function app status
az functionapp show \
  --name up-to-actual \
  --resource-group up-to-actual_group

# List application settings (values will show as null — that's normal)
az functionapp config appsettings list \
  --name up-to-actual \
  --resource-group up-to-actual_group

# Set application settings
az functionapp config appsettings set \
  --name up-to-actual \
  --resource-group up-to-actual_group \
  --settings KEY="value"

# Get storage account connection string
az storage account show-connection-string \
  --name uptoactual \
  --resource-group up-to-actual_group \
  --query connectionString --output tsv

# List all resources in the resource group
az resource list \
  --resource-group up-to-actual_group \
  --output table

# Restart the function app
az functionapp restart \
  --name up-to-actual \
  --resource-group up-to-actual_group
```

### Local Development Workflow

```bash
# Install Azure Functions Core Tools
npm install -g azure-functions-core-tools@4

# Run locally (reads from local.settings.json)
func start

# Deploy to Azure
func azure functionapp publish up-to-actual --javascript --build remote
```

Running `func start` locally is essential for debugging. The deploy process swallows runtime errors. The local runtime prints them. Any time a deploy succeeds but functions aren't listed, run locally first.

---

*This project was built in Melbourne, Australia, February 2026.*
