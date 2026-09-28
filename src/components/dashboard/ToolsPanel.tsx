"use client";

import { useState } from "react";
import type { ActivityToolsSummary } from "@/lib/activity/queries";
import { formatInt } from "@/lib/format";

type Row = { key: string; name: string; count: number; detail?: string; children?: { name: string; count: number }[] };

const SHOWN = 8;

// Four ranked lists in one panel, separated by hairlines like the plan cluster.
export function ToolsPanel({ tools }: { tools: ActivityToolsSummary }) {
  const columns: { title: string; empty: string; rows: Row[]; extra?: { title: string; rows: Row[] } }[] = [
    {
      title: "MCP servers",
      empty: "No MCP calls in this range.",
      rows: tools.mcp.map((m) => ({ key: m.server, name: m.server, count: m.count, children: m.tools })),
    },
    {
      title: "Skills",
      empty: "No skills used in this range.",
      rows: tools.skill.map((s) => ({ key: s.name, name: s.name, count: s.count })),
    },
    {
      title: "Subagents",
      empty: "No subagents dispatched in this range.",
      rows: tools.subagent.map((a) => ({
        key: a.name,
        name: a.name,
        count: a.count,
        detail: a.models.map((m) => `${m.model} ${formatInt(m.count)}`).join(", "),
      })),
    },
    {
      title: "Built-in tools",
      empty: "No tool calls in this range.",
      rows: tools.builtin.map((b) => ({ key: b.name, name: b.name, count: b.count })),
      extra: tools.codex.length
        ? { title: "Codex", rows: tools.codex.map((c) => ({ key: `codex-${c.name}`, name: c.name, count: c.count })) }
        : undefined,
    },
  ];

  return (
    <div className="tools-panel">
      {columns.map((c) => (
        <div key={c.title} className="tools-col">
          <RankedList title={c.title} rows={c.rows} empty={c.empty} />
          {c.extra && (
            <div className="mt-6">
              <RankedList title={c.extra.title} rows={c.extra.rows} empty="" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function RankedList({ title, rows, empty }: { title: string; rows: Row[]; empty: string }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const total = rows.reduce((n, r) => n + r.count, 0);
  const max = rows[0]?.count ?? 1;
  const shown = all ? rows : rows.slice(0, SHOWN);

  return (
    <section>
      <header className="flex items-baseline justify-between gap-3 mb-3">
        <h4 className="text-sm font-medium">{title}</h4>
        {rows.length > 0 && (
          <span className="text-xs text-muted tabular-nums">
            {formatInt(total)} {total === 1 ? "call" : "calls"}
          </span>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => {
            const expandable = !!r.children?.length;
            const isOpen = open === r.key;
            const label = (
              <>
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm">
                    {expandable && (
                      <span aria-hidden className="inline-block w-3 text-muted">
                        {isOpen ? "▾" : "▸"}
                      </span>
                    )}
                    {r.name}
                  </span>
                  <span className="text-sm tabular-nums text-muted">{formatInt(r.count)}</span>
                </span>
                <span aria-hidden className="block h-1 mt-1 rounded-full bg-meter-track">
                  <span className="block h-1 rounded-full bg-tool-bar" style={{ width: `${Math.max(2, (r.count / max) * 100)}%` }} />
                </span>
              </>
            );
            return (
              <li key={r.key}>
                {expandable ? (
                  <button
                    className="block w-full text-left rounded-md hover:bg-card-border/40 -mx-1 px-1 py-0.5"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : r.key)}
                  >
                    {label}
                  </button>
                ) : (
                  <div className="py-0.5">{label}</div>
                )}
                {r.detail && <p className="text-xs text-muted mt-1">{r.detail}</p>}
                {isOpen && r.children && (
                  <ul className="mt-2 mb-1 ml-3 space-y-1 border-l border-card-border pl-3">
                    {r.children.map((t) => (
                      <li key={t.name} className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="truncate font-mono">{t.name}</span>
                        <span className="tabular-nums text-muted">{formatInt(t.count)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > SHOWN && (
        <button onClick={() => setAll(!all)} className="mt-3 text-xs text-muted hover:text-foreground underline underline-offset-2">
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}
