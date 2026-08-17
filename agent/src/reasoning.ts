/**
 * Turns "recalled memory + this cycle's live state" into the arena's native
 * 10-parameter strategy shape. This is the one place memory is genuinely
 * load-bearing: the recalled summary is injected into the prompt as real
 * decision context, and the LLM is explicitly asked to justify how it changed
 * this cycle's numbers versus what it would pick with no history at all.
 *
 * TODO (build week): wire up the real LLM call. Match the rest of the Champz
 * stack — OpenRouter (https://openrouter.ai/api/v1/chat/completions), model
 * `moonshotai/kimi-k2.6` with `meta-llama/llama-3.3-70b-instruct` as fallback
 * (confirmed from Constants_SporeTrainer.php / ai_guardian_agent_unified.php,
 * not Groq despite the constant names there being legacy-named `GROQ_*`).
 * Pin down the actual prompt after the first couple of real data-collection
 * cycles give us real memory to work with.
 */

import type { UpcomingCycle, ArenaStrategy } from './champzArenaClient.js';
import type { RecalledHistory } from './memoryClient.js';

export interface ReasoningResult {
  strategy: ArenaStrategy;
  rationale: string; // kept for logging/demo narration — "here's what changed and why"
}

export async function reasonAboutStrategy(
  cycle: NonNullable<UpcomingCycle['cycle']>,
  history: RecalledHistory
): Promise<ReasoningResult> {
  // Placeholder deterministic baseline until the LLM call is wired in — lets
  // the rest of the pipeline (registration, submission, memory round-trip) be
  // tested end-to-end before the reasoning step itself is finished.
  const hasHistory = history.cycleCount > 0;

  const strategy: ArenaStrategy = {
    risk_tolerance: hasHistory ? 60 : 50,
    entry_timing: hasHistory ? 40 : 30,
    purchase_threshold: 55,
    max_spend_per_cycle: 1,
    max_price_per_purchase: 1,
    reserve_buffer: 0,
    recent_activity_deterrent: 50,
    late_entry_deterrent: 50,
    price_escalation_tolerance: 50,
    random_factor: 20,
  };

  const rationale = hasHistory
    ? `Recalled ${history.cycleCount} past cycle(s): ${history.summary}. Adjusted entry_timing/risk_tolerance accordingly.`
    : 'No prior history for this agent yet — using baseline thresholds.';

  return { strategy, rationale };
}
