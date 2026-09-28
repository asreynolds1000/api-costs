import type { PlanUsage } from "./parse";

// Plans read from a vendor API (unlike Claude/Codex, which come from local files). They are
// fetched by the scheduler tick and cached here; page renders never call the vendor.

// fetchedAt = last successful reading (what the UI shows); attemptedAt drives refresh timing
type Reading<T> = { data: T | null; fetchedAt: string | null; attemptedAt: string | null; error: string | null };
type ElevenLabs = { tier: string; count: number; limit: number; resetsAt: number | null };
type MagicHour = { tier: string; credits: number };
type Cache = { elevenlabs: Reading<ElevenLabs>; magichour: Reading<MagicHour> };

const empty = { data: null, fetchedAt: null, attemptedAt: null, error: null };
// Shared across the route and instrumentation bundles, which load separate module copies
const g = globalThis as unknown as { __quotaCache?: Cache; __quotaRefresh?: Promise<void> };
const cache = (g.__quotaCache ??= { elevenlabs: { ...empty }, magichour: { ...empty } });

const TIMEOUT_MS = 20_000;
const STALE_MS = 35 * 60 * 1000;
const monthly = 30 * 24 * 60;

async function getJson(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function readElevenLabs(): Promise<ElevenLabs> {
  const d = await getJson("https://api.elevenlabs.io/v1/user/subscription", {
    "xi-api-key": process.env.ELEVENLABS_API_KEY!,
  });
  const count = Number(d.character_count);
  const limit = Number(d.character_limit);
  if (!Number.isFinite(count) || !Number.isFinite(limit)) throw new Error("No character counts in response");
  const reset = Number(d.next_character_count_reset_unix);
  return { tier: String(d.tier ?? ""), count, limit, resetsAt: Number.isFinite(reset) ? reset : null };
}

async function readMagicHour(): Promise<MagicHour> {
  const d = await getJson("https://api.magichour.ai/v1/account", {
    Authorization: `Bearer ${process.env.MAGIC_HOUR_API_KEY}`,
  });
  const credits = Number(d.credits);
  if (!Number.isFinite(credits)) throw new Error("No credit balance in response");
  return { tier: String(d.tier ?? ""), credits };
}

async function refreshOne<T>(slot: Reading<T>, read: () => Promise<T>) {
  try {
    slot.data = await read();
    slot.error = null;
    slot.fetchedAt = new Date().toISOString();
  } catch (err) {
    // Keep the last good reading; surface the error next to it
    slot.error = err instanceof Error ? err.message : String(err);
  }
  slot.attemptedAt = new Date().toISOString();
}

export function refreshQuotas(): Promise<void> {
  g.__quotaRefresh ??= (async () => {
    const jobs: Promise<void>[] = [];
    if (process.env.ELEVENLABS_API_KEY) jobs.push(refreshOne(cache.elevenlabs, readElevenLabs));
    if (process.env.MAGIC_HOUR_API_KEY) jobs.push(refreshOne(cache.magichour, readMagicHour));
    await Promise.all(jobs);
  })().finally(() => {
    g.__quotaRefresh = undefined;
  });
  return g.__quotaRefresh;
}

function stale(r: Reading<unknown>) {
  return !r.attemptedAt || Date.now() - new Date(r.attemptedAt).getTime() > STALE_MS;
}

// Titlecase a vendor tier ("free" → "Free")
const tierName = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : "");

export function getQuotaPlans(): PlanUsage[] {
  // Without the scheduler (e.g. `next dev`), a stale cache refreshes in the background
  const configured = [
    process.env.ELEVENLABS_API_KEY ? cache.elevenlabs : null,
    process.env.MAGIC_HOUR_API_KEY ? cache.magichour : null,
  ].filter((r) => r !== null);
  // Only configured vendors count: an unconfigured slot is never attempted, so it stays "stale"
  if (configured.some(stale)) void refreshQuotas();

  const plans: PlanUsage[] = [];

  if (process.env.ELEVENLABS_API_KEY) {
    const r = cache.elevenlabs;
    const name = r.data?.tier ? `ElevenLabs ${tierName(r.data.tier)}` : "ElevenLabs";
    if (r.data) {
      const { count, limit, resetsAt } = r.data;
      plans.push({
        id: "elevenlabs",
        name,
        status: "ok",
        windows: [
          {
            key: "elevenlabs-monthly",
            label: "Monthly characters",
            windowMinutes: monthly,
            usedPercent: limit > 0 ? (count / limit) * 100 : null,
            resetsAt,
            updatedAt: r.fetchedAt,
            reset: false,
            detail: `${count.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")} characters`,
          },
        ],
        updatedAt: r.fetchedAt,
      });
    } else {
      plans.push({
        id: "elevenlabs",
        name,
        status: r.error ? "error" : "missing",
        message: r.error ? `Couldn't read usage: ${r.error}` : "Waiting for the first reading.",
        windows: [],
        updatedAt: null,
      });
    }
  }

  if (process.env.MAGIC_HOUR_API_KEY) {
    const r = cache.magichour;
    const name = r.data?.tier ? `Magic Hour ${tierName(r.data.tier)}` : "Magic Hour";
    plans.push(
      r.data
        ? {
            id: "magichour",
            name,
            status: "ok",
            windows: [],
            updatedAt: r.fetchedAt,
            balance: { label: "Credits left", value: r.data.credits.toLocaleString("en-US") },
          }
        : {
            id: "magichour",
            name,
            status: r.error ? "error" : "missing",
            message: r.error ? `Couldn't read credits: ${r.error}` : "Waiting for the first reading.",
            windows: [],
            updatedAt: null,
          }
    );
  }

  return plans;
}
