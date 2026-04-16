"use client";

import { useState, useEffect, useRef } from "react";

const MODELS_BY_PROVIDER: Record<string, string[]> = {
  gemini: [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-3.1-pro-preview",
    "gemini-3-pro-image-preview",
    "gemini-3.1-flash-image-preview",
    "gemini-2.5-flash-image",
  ],
  openai: [
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-image-1.5",
    "o4-mini",
    "o3",
    "whisper-1",
    "tts-1",
  ],
  xai: [
    "grok-4.20-0309-reasoning",
    "grok-4-1-fast-reasoning",
    "grok-imagine-image",
    "grok-imagine-video",
    "grok-code-fast-1",
  ],
};

type ManualEntryFormProps = {
  onClose: () => void;
};

export function ManualEntryForm({ onClose }: ManualEntryFormProps) {
  const [provider, setProvider] = useState("gemini");
  const [model, setModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [costUsd, setCostUsd] = useState("");
  const [tokensIn, setTokensIn] = useState("");
  const [tokensOut, setTokensOut] = useState("");
  const [requests, setRequests] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLSelectElement>(null);

  // Focus trap and escape key
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Focus first input on mount
    firstInputRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab" && dialog) {
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const finalModel = model === "__custom" ? customModel : model;
    if (!finalModel) {
      setError("Model is required");
      setSubmitting(false);
      return;
    }

    const cost = parseFloat(costUsd);
    if (isNaN(cost) || cost < 0) {
      setError("Valid cost is required");
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/entries/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model: finalModel,
          date,
          costUsd: cost,
          tokensIn: tokensIn ? parseInt(tokensIn, 10) : undefined,
          tokensOut: tokensOut ? parseInt(tokensOut, 10) : undefined,
          requests: requests ? parseInt(requests, 10) : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to save");
        return;
      }

      window.location.reload();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  const models = MODELS_BY_PROVIDER[provider] ?? [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-entry-title"
        className="bg-card border border-card-border rounded-xl p-6 w-full max-w-md"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="manual-entry-title" className="text-lg font-semibold">Add Cost Entry</h2>
          <button onClick={onClose} aria-label="Close dialog" className="text-muted hover:text-foreground text-xl">
            x
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="me-provider" className="block text-xs text-muted mb-1">Provider</label>
              <select
                id="me-provider"
                ref={firstInputRef}
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setModel("");
                }}
                className="w-full bg-background border border-card-border rounded px-3 py-1.5 text-sm"
              >
                <option value="gemini">Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="xai">xAI</option>
              </select>
            </div>
            <div>
              <label htmlFor="me-date" className="block text-xs text-muted mb-1">Date</label>
              <input
                id="me-date"
                type="date"
                value={date}
                max={today}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-background border border-card-border rounded px-3 py-1.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="me-model" className="block text-xs text-muted mb-1">Model</label>
            <select
              id="me-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-background border border-card-border rounded px-3 py-1.5 text-sm"
            >
              <option value="">Select model...</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value="__custom">Other (type below)</option>
            </select>
            {model === "__custom" && (
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="Model name"
                aria-label="Custom model name"
                className="w-full mt-2 bg-background border border-card-border rounded px-3 py-1.5 text-sm"
              />
            )}
          </div>

          <div>
            <label htmlFor="me-cost" className="block text-xs text-muted mb-1">Cost (USD)</label>
            <input
              id="me-cost"
              type="number"
              step="0.0001"
              min="0"
              value={costUsd}
              onChange={(e) => setCostUsd(e.target.value)}
              placeholder="0.00"
              className="w-full bg-background border border-card-border rounded px-3 py-1.5 text-sm font-mono"
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="me-tokens-in" className="block text-xs text-muted mb-1">Tokens In</label>
              <input
                id="me-tokens-in"
                type="number"
                value={tokensIn}
                onChange={(e) => setTokensIn(e.target.value)}
                placeholder="optional"
                className="w-full bg-background border border-card-border rounded px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label htmlFor="me-tokens-out" className="block text-xs text-muted mb-1">Tokens Out</label>
              <input
                id="me-tokens-out"
                type="number"
                value={tokensOut}
                onChange={(e) => setTokensOut(e.target.value)}
                placeholder="optional"
                className="w-full bg-background border border-card-border rounded px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label htmlFor="me-requests" className="block text-xs text-muted mb-1">Requests</label>
              <input
                id="me-requests"
                type="number"
                value={requests}
                onChange={(e) => setRequests(e.target.value)}
                placeholder="optional"
                className="w-full bg-background border border-card-border rounded px-3 py-1.5 text-sm font-mono"
              />
            </div>
          </div>

          {error && (
            <p role="alert" aria-live="polite" className="text-red-400 text-xs">{error}</p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 text-sm border border-card-border rounded-lg hover:bg-card-border/30 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2 text-sm bg-accent-blue text-white rounded-lg hover:bg-accent-blue/80 transition-colors disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Add Entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
