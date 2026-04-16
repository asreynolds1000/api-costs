import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/providers/registry";
import { logSync } from "@/lib/db/queries";
import { db, schema } from "@/lib/db";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const adapter = getAdapter(provider);

  if (!adapter) {
    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }

  if (!adapter.isConfigured()) {
    return NextResponse.json(
      { error: `${provider} is not configured. Check .env.local` },
      { status: 400 }
    );
  }

  try {
    // Sync last 90 days by default
    const since = new Date();
    since.setDate(since.getDate() - 90);

    const entries = await adapter.sync(since);

    // Upsert entries
    let synced = 0;
    for (const entry of entries) {
      db.insert(schema.costEntries)
        .values({
          provider: entry.provider,
          model: entry.model,
          date: entry.date,
          costUsd: entry.costUsd,
          unitType: entry.unitType,
          units: entry.units ?? null,
          direction: entry.direction ?? null,
          tokensIn: entry.tokensIn ?? null,
          tokensOut: entry.tokensOut ?? null,
          requests: entry.requests ?? null,
          rawLineItem: entry.rawLineItem ?? null,
          source: "api_sync",
          syncedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: [
            schema.costEntries.provider,
            schema.costEntries.model,
            schema.costEntries.date,
            schema.costEntries.direction,
            schema.costEntries.rawLineItem,
            schema.costEntries.source,
          ],
          set: {
            costUsd: entry.costUsd,
            unitType: entry.unitType,
            units: entry.units ?? null,
            tokensIn: entry.tokensIn ?? null,
            tokensOut: entry.tokensOut ?? null,
            requests: entry.requests ?? null,
            syncedAt: new Date().toISOString(),
          },
        })
        .run();
      synced++;
    }

    logSync(provider, "success", synced);

    return NextResponse.json({ ok: true, recordsSynced: synced });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logSync(provider, "error", 0, message);
    // Don't leak full API error details to client
    const safeMessage = message.includes("not configured")
      ? message
      : message.includes("not found")
        ? message
        : `Sync failed for ${provider}`;
    return NextResponse.json({ error: safeMessage }, { status: 500 });
  }
}
