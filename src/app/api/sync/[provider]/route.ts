import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/providers/registry";
import { syncProvider } from "@/lib/sync";

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
    return NextResponse.json({ error: `${provider} is not configured. Check .env.local` }, { status: 400 });
  }

  const result = await syncProvider(provider);
  if (result.ok) return NextResponse.json({ ok: true, recordsSynced: result.records });
  // The full error is in sync_log; don't echo provider API details to the client
  return NextResponse.json({ error: `Sync failed for ${provider}` }, { status: 500 });
}
