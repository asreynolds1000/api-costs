// Pure parsing for OpenAI cost report line items. No path-alias imports, so tests can load it.

export type ParsedLineItem = { model: string; direction: string; unitType: string };

// "gpt-4o, input", "gpt-6.1-sol, cache writes", "gpt-5.4-2026-03-05, cached input, long context"
const TOKEN_LINE = /^(.+?),\s*(cached input|input audio|output audio|input|output|cache writes)(?:,\s*long context)?$/i;

// Parse OpenAI line_item strings like "gpt-4o, input" or "Image models".
// A change here changes the model and direction stored for a line, and both are part of the
// cost_entries dedup key: re-key the rows already stored (see scripts/reparse-openai.mts).
export function parseLineItem(lineItem: string): ParsedLineItem {
  const token = lineItem.match(TOKEN_LINE);
  if (token) {
    return {
      model: token[1].trim(),
      direction: /input|cache/i.test(token[2]) ? "input" : "output",
      unitType: "tokens",
    };
  }

  // Category-level items like "Image models", "Audio models", "whisper"
  if (/image/i.test(lineItem)) {
    return { model: lineItem, direction: "total", unitType: "images" };
  }
  if (/audio|^whisper\b/i.test(lineItem)) {
    return { model: lineItem, direction: "total", unitType: "flat" };
  }
  if (/web search/i.test(lineItem)) {
    return { model: lineItem, direction: "total", unitType: "requests" };
  }

  // Fallback: store the raw string as the model name
  console.warn(`[openai] Unrecognized line_item format: "${lineItem}"`);
  return { model: lineItem, direction: "total", unitType: "unknown" };
}
