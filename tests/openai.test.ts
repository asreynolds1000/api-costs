// Run with: npm test   (node --test, no framework)
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLineItem } from "../src/lib/providers/openai-parse.ts";

const parse = (line: string) => {
  const { model, direction, unitType } = parseLineItem(line);
  return [model, direction, unitType];
};

test("openai: token lines keep parsing as before", () => {
  assert.deepEqual(parse("gpt-4o, input"), ["gpt-4o", "input", "tokens"]);
  assert.deepEqual(parse("gpt-4o, cached input"), ["gpt-4o", "input", "tokens"]);
  assert.deepEqual(parse("gpt-4o, output"), ["gpt-4o", "output", "tokens"]);
  assert.deepEqual(parse("gpt-4o-audio, input audio"), ["gpt-4o-audio", "input", "tokens"]);
  assert.deepEqual(parse("gpt-4o-audio, output audio"), ["gpt-4o-audio", "output", "tokens"]);
  assert.deepEqual(parse("Image models"), ["Image models", "total", "images"]);
  assert.deepEqual(parse("Audio models"), ["Audio models", "total", "flat"]);
});

// Line items seen in the cost report that used to fall through to "unknown" (2026-11)
test("openai: cache writes, long context, whisper and web search are recognized", () => {
  assert.deepEqual(parse("gpt-6.1-sol, cache writes"), ["gpt-6.1-sol", "input", "tokens"]);
  assert.deepEqual(parse("gpt-5.4-2026-03-05, input, long context"), ["gpt-5.4-2026-03-05", "input", "tokens"]);
  assert.deepEqual(parse("gpt-5.4-2026-03-05, cached input, long context"), ["gpt-5.4-2026-03-05", "input", "tokens"]);
  assert.deepEqual(parse("gpt-5.4-2026-03-05, output, long context"), ["gpt-5.4-2026-03-05", "output", "tokens"]);
  assert.deepEqual(parse("whisper"), ["whisper", "total", "flat"]);
  assert.deepEqual(parse("web search tool calls"), ["web search tool calls", "total", "requests"]);
});

test("openai: an unknown line still falls back to the raw string", () => {
  const warn = console.warn;
  const seen: string[] = [];
  console.warn = (msg: string) => seen.push(msg);
  try {
    assert.deepEqual(parse("brand new thing"), ["brand new thing", "total", "unknown"]);
  } finally {
    console.warn = warn;
  }
  assert.equal(seen.length, 1);
});
