/**
 * Thin client for the local sibyl-bridge service (see sibyl-bridge/app.py).
 * Kept deliberately dumb — all the actual Sibyl SDK/CLI mechanics live in the
 * Python bridge, not here. See docs/ARCHITECTURE.md for why this is split
 * across two languages.
 */

import { config } from './config.js';

export interface CycleMemoryEntry {
  agentId: string;
  cycleId: number;
  entryPrice: number | null;
  entryTimingPct: number | null; // 0-100, how far into the cycle we entered
  outcome: 'won' | 'lost' | 'no_entry';
  winningPrice: number | null;
  opponents: string[];
  notes?: string;
}

export interface RecalledHistory {
  agentId: string;
  cycleCount: number;
  summary: string; // compact natural-language recall, ready to drop into an LLM prompt
  entries: CycleMemoryEntry[];
}

function url(path: string): string {
  return `${config.sibylBridgeBaseUrl}${path}`;
}

export async function recall(agentId: string): Promise<RecalledHistory> {
  const res = await fetch(url(`/recall?agentId=${encodeURIComponent(agentId)}`));
  return res.json() as Promise<RecalledHistory>;
}

export async function remember(entry: CycleMemoryEntry): Promise<{ success: boolean }> {
  const res = await fetch(url('/remember'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  return res.json() as Promise<{ success: boolean }>;
}
