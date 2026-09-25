import { NextResponse } from "next/server";
import { getPlanUsage } from "@/lib/plans";

export async function GET() {
  return NextResponse.json(getPlanUsage());
}
