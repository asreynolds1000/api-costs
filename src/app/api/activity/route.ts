import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getActivity } from "@/lib/activity/queries";
import { toEasternDate, shiftDate } from "@/lib/timezone";

const QuerySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    start: url.searchParams.get("start") ?? undefined,
    end: url.searchParams.get("end") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const today = toEasternDate(new Date());
  const end = parsed.data.end ?? today;
  const start = parsed.data.start ?? shiftDate(end, -89); // default: last 90 days

  const data = getActivity(start, end);
  return NextResponse.json(data);
}
