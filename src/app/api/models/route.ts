import { NextResponse } from "next/server";
import { getModelSpend } from "@/lib/db/queries";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const startDate = url.searchParams.get("start") ?? undefined;
  const endDate = url.searchParams.get("end") ?? undefined;

  const models = getModelSpend(startDate, endDate);
  return NextResponse.json(models);
}
