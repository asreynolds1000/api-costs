import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { insertManualEntry } from "@/lib/db/queries";

const ManualEntrySchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  costUsd: z.number().min(0),
  tokensIn: z.number().int().optional(),
  tokensOut: z.number().int().optional(),
  requests: z.number().int().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = ManualEntrySchema.parse(body);

    insertManualEntry({
      provider: parsed.provider,
      model: parsed.model,
      date: parsed.date,
      costUsd: parsed.costUsd,
      tokensIn: parsed.tokensIn,
      tokensOut: parsed.tokensOut,
      requests: parsed.requests,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to save entry" }, { status: 500 });
  }
}
