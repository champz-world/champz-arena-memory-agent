/**
 * Thin client for the local sibyl-bridge service (see sibyl-bridge/app.py).
 * Kept deliberately dumb — all the actual Sibyl SDK/CLI mechanics live in the
 * Python bridge, not here. See docs/ARCHITECTURE.md for why this is split
 * across two languages.
 */

import { config } from './config.js';

// Matches GET /my-history's per-cycle shape (see champzArenaClient.ts's
// MyHistoryCycle) plus the derived roiPct the success metric is built on.
// Success = ROI on spend (rewardEarned vs totalPaid), NOT win/loss —
// max_spend_per_cycle / max_price_per_purchase stay fixed across every
// cycle on purpose, so only the strategy's judgment params are the thing
// memory should ever be changing.
export interface CycleMemoryEntry {
  agentId: string;
  cycleId: number;
  strategy: Record<string, number>; // the 10 submitted strategy params for this cycle
  totalPaid: number;
  rewardEarned: number;
  roiPct: number;
  won: boolean;
  holdDurationSeconds: number;
  entryPrice: number | null;
  entryTimingPct: number | null; // 0-100, how far into the cycle we entered
  competitorCount?: number | null;
  topCompetitorHoldSeconds?: number | null;
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
