import { NextResponse } from "next/server";
import { indexActivity } from "@/lib/activity/indexer";

export async function POST() {
  const result = await indexActivity();
  return NextResponse.json(result);
}
