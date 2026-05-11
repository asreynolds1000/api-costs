import type { ProviderAdapter } from "./types";
import { OpenAIAdapter } from "./openai";
import { XaiAdapter } from "./xai";
import { GeminiAdapter } from "./gemini";
import { OpenRouterAdapter } from "./openrouter";
import { BflAdapter } from "./bfl";
import { FalAdapter } from "./fal";

const adapters: Record<string, ProviderAdapter> = {
  openai: new OpenAIAdapter(),
  xai: new XaiAdapter(),
  gemini: new GeminiAdapter(),
  openrouter: new OpenRouterAdapter(),
  bfl: new BflAdapter(),
  fal: new FalAdapter(),
};

export function getAdapter(provider: string): ProviderAdapter | undefined {
  return adapters[provider];
}

export function getAllAdapters(): ProviderAdapter[] {
  return Object.values(adapters);
}
