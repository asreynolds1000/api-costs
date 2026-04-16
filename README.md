# API Cost Dashboard

Track AI API spending across OpenAI, xAI/Grok, Google Gemini, and OpenRouter in a single dashboard.

Pulls actual billed amounts from each provider's billing API. No proxies, no estimations from token counts. Runs locally with SQLite storage.

## What it does

- **Period summaries** -- today, this week, month, year, all time
- **Daily spend chart** -- stacked by provider, 7d/30d/90d/1y range picker
- **Provider breakdown** -- donut chart with percentages
- **Model table** -- sortable by cost, model, or provider
- **Manual entry** -- add costs for any provider (useful before APIs are configured)
- **Auto-sync on page load** -- syncs all providers once per hour when you visit the dashboard
- Dark theme, responsive layout, keyboard accessible

## Provider support

| Provider | Data source | What you need |
|----------|------------|---------------|
| OpenAI | Admin API (`/v1/organization/costs`) | Admin key (`sk-admin-*`) |
| xAI / Grok | Management API (actual USD) | Management key + team ID |
| Gemini | GCP BigQuery billing export | Service account + billing export enabled |
| OpenRouter | Activity API | Management key |

Each provider is optional. The dashboard works with any combination, including zero configured providers (manual entry only).

## Quick start

```bash
git clone <repo-url> && cd api-costs
npm install
npx drizzle-kit push
cp .env.example .env.local
# Edit .env.local with your API keys (see provider setup below)
npm run dev
# Open http://localhost:4100
```

## Provider setup

### OpenAI

1. Go to [platform.openai.com](https://platform.openai.com) > Organization Settings > Admin Keys
2. Create an admin key (requires org owner role)
3. Add to `.env.local`:
   ```
   OPENAI_ADMIN_KEY=sk-admin-xxxxx
   ```

### xAI / Grok

1. Go to [console.x.ai](https://console.x.ai) > Settings > Management Keys
2. Create a management key
3. Copy your team ID from console.x.ai/team/default/settings/team
4. Add to `.env.local`:
   ```
   XAI_MANAGEMENT_KEY=xai-mgmt-xxxxx
   XAI_TEAM_ID=your-team-id
   ```

### OpenRouter

1. Go to [openrouter.ai](https://openrouter.ai) > Account Settings
2. Copy your management API key
3. Add to `.env.local`:
   ```
   OPENROUTER_MGMT_KEY=sk-or-v1-xxxxx
   ```

### Gemini (GCP BigQuery billing export)

The most involved setup, but gives you exact dollar amounts from Google.

**Step 1: Create a BigQuery dataset**

1. Go to [BigQuery Console](https://console.cloud.google.com/bigquery)
2. Select the GCP project your Gemini API key is attached to
3. Create a dataset called `billing_export` (location: US)

**Step 2: Enable billing export**

1. Go to [Billing Export](https://console.cloud.google.com/billing/export)
2. Select your billing account
3. BigQuery Export tab > Standard usage cost > Edit Settings
4. Select your project and the `billing_export` dataset
5. Save. Initial data takes up to 5 days to appear. Backfills ~30 days.

**Step 3: Create a service account**

Using the gcloud CLI:

```bash
gcloud config set project YOUR_PROJECT_ID

gcloud iam service-accounts create api-costs-reader \
  --display-name="API Costs Dashboard Reader"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:api-costs-reader@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataViewer"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:api-costs-reader@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/bigquery.jobUser"

gcloud iam service-accounts keys create /path/to/api-costs-sa.json \
  --iam-account=api-costs-reader@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

Or use the [GCP Console UI](https://console.cloud.google.com/iam-admin/serviceaccounts/create): create a service account with BigQuery Data Viewer + BigQuery Job User roles, then download a JSON key from the Keys tab.

**Step 4: Configure**

Add to `.env.local`:
```
GOOGLE_APPLICATION_CREDENTIALS=/path/to/api-costs-sa.json
GCP_BILLING_PROJECT=your-project-id
GCP_BILLING_DATASET=billing_export
```

The billing export table name is auto-detected on sync. To set it explicitly:
```
GCP_BILLING_TABLE=project.dataset.gcp_billing_export_v1_XXXXXX
```

**Troubleshooting:**
- **Empty sync results** -- billing export takes up to 5 days for initial backfill
- **"Not found: Table"** -- table hasn't been created yet, check back later
- **"Access Denied"** -- service account needs both `bigquery.dataViewer` and `bigquery.jobUser`

## Running as a background service

Using pm2:

```bash
npm install -g pm2
npm run build
pm2 start npm --name "api-costs" -- start
pm2 startup    # auto-start on login (follow the printed instructions)
pm2 save       # persist process list
```

Dashboard runs at `localhost:4100` and auto-restarts on crash.

```bash
pm2 status              # check if running
pm2 logs api-costs      # view logs
pm2 restart api-costs   # restart after code changes
```

## Adding a new provider

1. Create `src/lib/providers/yourprovider.ts` implementing the `ProviderAdapter` interface
2. Register it in `src/lib/providers/registry.ts`
3. Add a color in `src/app/globals.css` and `src/lib/format.ts`
4. Add the provider to the `providers` array and `defaults` object in `SpendTimeline.tsx`
5. Add env var check in `src/app/page.tsx`

## Tech stack

- Next.js 16, React 19, TypeScript 5
- Tailwind 4
- Drizzle ORM + SQLite (better-sqlite3)
- Recharts 3
- Zod 4

## License

MIT
