/**
 * Client for the Champz AI Arena's public agent API.
 *
 * Every endpoint/shape here is taken verbatim from the authoritative agent
 * runbook (VIRTUAL_CUSTOM_FUNCTIONS.md, the same doc Champz points EconomyOS
 * agents at over ACP chat to onboard themselves) — not guessed, and cross-
 * checked against the live controller source in champz-backend. Still needs
 * one real end-to-end run against a live low-stakes cycle before this is
 * fully trusted (see docs/ARCHITECTURE.md open items).
 */

import { config } from './config.js';

function url(path: string): string {
  return `${config.champzArenaBaseUrl}${path}`;
}

function authHeaders(apiKey: string): Record<string, string> {
  return { 'X-API-Key': apiKey, 'Content-Type': 'application/json' };
}

// ── Step 1 — Register (one-time) ───────────────────────────────────────────

export interface RegistrationChallenge {
  success: boolean;
  nonce: string;
  message: string;
  expires_in: number;
}

export async function getRegistrationChallenge(wallet: string): Promise<RegistrationChallenge> {
  const res = await fetch(url(`/register/challenge?wallet=${wallet}`));
  return res.json() as Promise<RegistrationChallenge>;
}

export interface RegisterResult {
  success: boolean;
  api_key?: string; // shown once only — store immediately, cannot be retrieved again
  execution_wallet?: string;
  agent_id?: number;
  message?: string;
}

export async function registerAgent(params: {
  wallet: string;
  nonce: string;
  signature: string;
  agentName?: string;
  virtualsAgentId?: string; // confirmed accepted server-side (Api_AIAgent_Register.php), not advertised in the public runbook
}): Promise<RegisterResult> {
  const res = await fetch(url('/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet: params.wallet,
      nonce: params.nonce,
      signature: params.signature,
      agent_name: params.agentName,
      virtuals_agent_id: params.virtualsAgentId,
    }),
  });
  return res.json() as Promise<RegisterResult>;
}

// ── Step 2 — Check for an upcoming cycle ───────────────────────────────────

export interface UpcomingCycle {
  available: boolean;
  my_status?: { enrolled: boolean };
  cycle: {
    cycle_id: number;
    start_time: string;
    duration_minutes: number;
    chain: 'base' | 'robinhood';
    chain_id: number;
    chain_label: string;
    token: string;
    token_address: string;
    token_decimals: number;
    starting_price: string; // numeric string, not a number — matches the API verbatim
    price_multiplier: number;
    base_reward: string;
    strategy_deadline: string;
    max_slots: number;
    enrolled_count: number;
    slots_remaining: number;
  } | null;
}

export async function getUpcomingCycle(apiKey: string): Promise<UpcomingCycle> {
  const res = await fetch(url('/upcoming-cycle'), { headers: authHeaders(apiKey) });
  return res.json() as Promise<UpcomingCycle>;
}

// ── Step 3 — Enroll ─────────────────────────────────────────────────────────

export interface EnrollResult {
  enrolled: boolean;
  reason?: string; // present when enrolled === false (cycle full, deadline passed, already enrolled)
  slot?: number;
  cycle?: {
    cycle_id: number;
    execution_wallet: string;
    token: string;
    token_address: string;
    token_decimals: number;
    starting_price: string;
    strategy_deadline: string;
    max_slots: number;
    slot: number;
  };
}

export async function enrollInCycle(apiKey: string, cycleId: number): Promise<EnrollResult> {
  const res = await fetch(url('/enroll'), {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ cycle_id: cycleId }),
  });
  return res.json() as Promise<EnrollResult>;
}

// ── Step 4 — Fund execution wallet ─────────────────────────────────────────
// NOT an HTTP call — an on-chain token transfer from the agent's own wallet to
// `execution_wallet`, on the cycle's `chain`. See docs/ARCHITECTURE.md: wiring
// this through the ACP provider's sendTransaction is a "later" item (points 3
// & 4 from planning) — for now this just produces the human-actionable
// instructions the runbook itself sanctions as a fallback ("if you don't have
// a send capability, tell the human the exact amount/token/chain/destination").

export interface FundingInstructions {
  action: 'send_token';
  amountHint: string;
  token: string;
  tokenAddress: string;
  tokenDecimals: number;
  chain: string;
  destination: string;
}

export function buildFundingInstructions(
  cycle: EnrollResult['cycle'],
  amountHint: string
): FundingInstructions | null {
  if (!cycle) return null;
  return {
    action: 'send_token',
    amountHint,
    token: cycle.token,
    tokenAddress: cycle.token_address,
    tokenDecimals: cycle.token_decimals,
    chain: 'base', // upcoming-cycle carries the authoritative chain; pass through explicitly at call sites once wired
    destination: cycle.execution_wallet,
  };
}

// ── Step 5 — Submit strategy ────────────────────────────────────────────────
// Arena's native strategy shape — same 10 parameters used by every mode of
// Champz's shared agent decision engine. Our reasoning step produces these;
// Champz's own executor drives every tick-by-tick decision from here.

export interface ArenaStrategy {
  risk_tolerance: number; // 0-100
  entry_timing: number; // 0-100 — start buying after this % of the cycle elapsed
  purchase_threshold: number; // 0-100 — lower = buys more often
  max_spend_per_cycle: number; // token units
  max_price_per_purchase: number; // token units
  reserve_buffer: number; // token units
  recent_activity_deterrent: number; // 0-100
  late_entry_deterrent: number; // 0-100 — 100 = never stop
  price_escalation_tolerance: number; // 0-100
  random_factor: number; // 0-100
}

export async function submitStrategy(
  apiKey: string,
  cycleId: number,
  strategy: ArenaStrategy
): Promise<{ success: boolean; message?: string }> {
  const res = await fetch(url('/strategy'), {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ cycle_id: cycleId, ...strategy }),
  });
  return res.json() as Promise<{ success: boolean; message?: string }>;
}

export async function getStrategy(apiKey: string, cycleId?: number): Promise<ArenaStrategy & { success: boolean }> {
  const qs = cycleId ? `?cycle_id=${cycleId}` : '';
  const res = await fetch(url(`/strategy${qs}`), { headers: authHeaders(apiKey) });
  return res.json() as Promise<ArenaStrategy & { success: boolean }>;
}

// ── Step 6 — (optional) arena personality ──────────────────────────────────

export type ChatMode =
  | 'strategic'
  | 'aggressive'
  | 'cautious'
  | 'philosopher'
  | 'villain'
  | 'chad'
  | 'degen'
  | 'oracle';

export async function setChatMode(apiKey: string, mode: ChatMode): Promise<{ success: boolean }> {
  const res = await fetch(url('/chat-mode'), {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ mode }),
  });
  return res.json() as Promise<{ success: boolean }>;
}

// ── Step 7 — (optional) monitor an active cycle ────────────────────────────
// Buy/send decisions during the cycle are executed automatically by Champz's
// backend from the submitted strategy — this is for narration/demo purposes
// (and reasoning about a *future* cycle's resubmission), not live control.

export async function getCycleState(apiKey: string): Promise<Record<string, unknown>> {
  const res = await fetch(url('/cycle-state'), { headers: authHeaders(apiKey) });
  return res.json() as Promise<Record<string, unknown>>;
}

// ── Step 8 — claims fallback (rewards are normally automatic) ─────────────

export interface PendingClaim {
  claim_id: number;
  nonce: string;
  signature: string;
  amount: string;
}

export async function getClaims(apiKey: string): Promise<{ pending: PendingClaim[] }> {
  const res = await fetch(url('/claims'), { headers: authHeaders(apiKey) });
  return res.json() as Promise<{ pending: PendingClaim[] }>;
}

export async function confirmClaim(apiKey: string, claimId: number, txHash: string): Promise<{ success: boolean }> {
  const res = await fetch(url(`/claims/${claimId}/confirm`), {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ tx_hash: txHash }),
  });
  return res.json() as Promise<{ success: boolean }>;
}

// ── Step 9 — (optional) execution wallet balance / withdraw ───────────────

export async function getExecutionWalletBalance(
  apiKey: string,
  chain: 'base' | 'robinhood' = 'base',
  tokenAddress?: string
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ chain, ...(tokenAddress ? { token_address: tokenAddress } : {}) });
  const res = await fetch(url(`/withdraw?${qs}`), { headers: authHeaders(apiKey) });
  return res.json() as Promise<Record<string, unknown>>;
}

export async function withdraw(
  apiKey: string,
  params: { chain?: 'base' | 'robinhood'; tokenAddress?: string; toAddress?: string }
): Promise<{ success: boolean }> {
  const res = await fetch(url('/withdraw'), {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      chain: params.chain ?? 'base',
      token_address: params.tokenAddress,
      to_address: params.toAddress,
    }),
  });
  return res.json() as Promise<{ success: boolean }>;
}
