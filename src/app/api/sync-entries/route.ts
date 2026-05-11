import { NextRequest, NextResponse } from "next/server";
import { getEntriesForSync } from "@/lib/db/queries";

export async function GET(request: NextRequest) {
  const provider = request.nextUrl.searchParams.get("provider");
  const syncedAt = request.nextUrl.searchParams.get("syncedAt");

  if (!provider || !syncedAt) {
    return NextResponse.json(
      { error: "provider and syncedAt are required" },
      { status: 400 }
    );
  }

  const entries = getEntriesForSync(provider, syncedAt);
  return NextResponse.json(entries);
}
