# Architecture

## Components

### `agent/` — Node/TypeScript

- **Identity & signing**: uses `@virtuals-protocol/acp-node-v2` (`PrivyAlchemyEvmProviderAdapter.create(...)` provisions the wallet, exposing `getAddress()` / `signMessage(chainId, message)`; separately wrapped in `AcpAgent.create({ evmProvider })` so this is a real, registry-discoverable ACP agent identity, not just a bare wallet borrowing the SDK's signing utility). See `agent/src/acpWallet.ts` for the full reasoning — this replaced an earlier wrong assumption that wallet setup went through the `acp-cli` package (deprecated).
- **Arena client** (`agent/src/champzArenaClient.ts`): calls Champz's existing public AI Arena agent API. Every endpoint/shape here is taken verbatim from the authoritative agent runbook (`VIRTUALS_CUSTOM_FUNCTIONS.md` — the same doc Champz points EconomyOS agents at over ACP chat to onboard themselves), cross-checked against the live controller source. Base URL: `https://api.champz.world/game/spore-trainer/ai-agent/`. Full flow:
  1. `GET /register/challenge?wallet=0x...` → one-time nonce + message to sign
  2. `POST /register` → `{ wallet, nonce, signature, agent_name?, virtuals_agent_id? }`, returns `{ api_key, execution_wallet, agent_id }` **once** — `api_key` cannot be retrieved again if lost (only reset by contacting the Champz team). `virtuals_agent_id` is an explicit, judge-verifiable hook declaring this is a real Virtuals agent at the registration layer. Signature verification supports plain EOA (ecrecover) as well as smart contract wallets (EIP-1271) automatically — no need to tell the backend which kind ours is.
  3. All subsequent calls authenticate via `X-API-Key: <api_key>`, not the wallet signature again.
  4. `GET /upcoming-cycle` → `available`, `my_status.enrolled`, and cycle details (chain, token, starting_price, price_multiplier, strategy_deadline, slots).
  5. `POST /enroll` → `{ cycle_id }` — **required before submitting a strategy**, was missing from an earlier pass of this plan. Returns the cycle's `execution_wallet` to fund.
  6. **Funding (not an HTTP call)** — a real on-chain token transfer from the agent's own wallet to `execution_wallet`, in the cycle's token, on its chain, before `strategy_deadline`. The runbook explicitly sanctions a human-fallback here for agents without wired-up send capability yet: report the exact amount/token/chain/destination. `agent/src/champzArenaClient.ts`'s `buildFundingInstructions()` does exactly that for now — wiring a real automated transfer through the ACP provider's `sendTransaction` is a later item (see open items).
  7. `POST /strategy` → the arena's actual strategy shape: `risk_tolerance, entry_timing, purchase_threshold, max_spend_per_cycle, max_price_per_purchase, reserve_buffer, recent_activity_deterrent, late_entry_deterrent, price_escalation_tolerance, random_factor`. **This is the same 10-parameter shape used by every mode of Champz's shared agent decision engine** — our agent isn't reimplementing arena logic, it's producing the arena's own native strategy format. Resubmittable any time before the deadline.
  8. `POST /chat-mode` (optional) → flavors the LLM-generated comments this agent posts to the public arena chat feed at [legends.champz.world/aiarena](https://legends.champz.world/aiarena) — nice polish for the spectator-watchable demo.
  9. `GET /cycle-state` (optional, during an active cycle) → live guardian/price/leaderboard, for narration during the demo. The actual buy/send decisions are executed automatically by Champz's backend from the submitted strategy — this is not a live control loop.
  10. After settlement, rewards go **automatically** to the registered `owner_wallet` on-chain. `GET /claims` / `POST /claims/{id}/confirm` exist only as a 30-day fallback if automatic distribution doesn't arrive.
- **Reasoning** (`agent/src/reasoning.ts`): one LLM call per cycle, submitted once before `strategy_deadline` — **not** a live per-tick polling loop. Input = this cycle's live state + recalled memory. Output = the 10 threshold parameters above.
- **Memory client** (`agent/src/memoryClient.ts`): thin HTTP client to the local `sibyl-bridge` service (`/recall` before reasoning, `/remember` after a cycle settles).

### `sibyl-bridge/` — Python/FastAPI

Sibyl Memory's documented integration surface is a Python CLI/SDK (`pip install 'sibyl-memory-cli[mcp]'`) built around MCP for AI coding assistants — there's no confirmed public REST API for arbitrary backend languages to call directly. This service is a minimal wrapper so the Node agent doesn't need a Python runtime embedded in it:

- `POST /remember` — body: `{ agentId, cycleId, entryPrice, entryTimingPct, outcome, opponents[], notes }`
- `GET /recall?agentId=...` — returns a compact summary of the agent's own past-cycle history for the reasoning step to consume

Currently backed by a local JSON file, smoke-tested end to end (`POST /remember` then `GET /recall` round-trips correctly) — swap-in point for the real Sibyl SDK/CLI once its programmatic surface is confirmed; the `/remember`/`/recall` contract shouldn't need to change either way.

## Why two languages instead of one

- The real, current ACP SDK (`@virtuals-protocol/acp-node-v2`) is Node/TypeScript.
- Sibyl Memory's SDK is Python-native.
- Rather than force a workaround in either direction, each piece uses its native tooling, connected by one small internal HTTP contract. This keeps both integrations honest — real ACP tooling, real Sibyl tooling — rather than reimplementing either from scratch.

## What's explicitly NOT touched

No changes to Champz's production backend or frontend. This agent is purely an external consumer of the AI Arena's already-public agent API — the same API any third-party EconomyOS agent uses to compete, following the same public runbook. That's true by construction, not something claimed after the fact.

## Open items / research spikes

- [x] Confirm Sibyl Memory has no public REST API — CLI/SDK + MCP only, hence the bridge service
- [x] Confirm ACP wallet/signing mechanics — `@virtuals-protocol/acp-node` (CLI-oriented) is **deprecated**; real current package is `@virtuals-protocol/acp-node-v2`, a proper importable SDK. `AcpAgent` doesn't itself expose signing — `PrivyAlchemyEvmProviderAdapter` does.
- [x] Confirm Champz AI Arena's exact request/response shapes — read from the authoritative public runbook (`VIRTUALS_CUSTOM_FUNCTIONS.md`) and cross-checked against controller source, including the **Enroll** step an earlier pass of this plan had missed entirely. Still needs one real end-to-end run against a live low-stakes cycle to catch anything the docs didn't show.
- [x] `agent/` type-checks clean (`npx tsc --noEmit`) against the real installed `@virtuals-protocol/acp-node-v2` package.
- [x] `sibyl-bridge/` smoke-tested locally.
- [x] LLM provider for the reasoning step — matches the rest of the Champz stack: **OpenRouter** (`https://openrouter.ai/api/v1/chat/completions`), model `moonshotai/kimi-k2.6` with `meta-llama/llama-3.3-70b-instruct` as fallback. (Corrected 2026-08-17 — initially assumed Groq from a name-based misread; the codebase's `GROQ_*` constants are legacy-named but actually point at OpenRouter.)
- [ ] **Real prerequisite, not code**: register the agent(s) at https://app.virtuals.io/acp/new (Service Registry), add a Signer under each agent's Signers tab to get `ACP_WALLET_ADDRESS` / `ACP_WALLET_ID` / `ACP_SIGNER_PRIVATE_KEY` — account-creation steps on Virtuals' own site. (In progress as of 2026-08-17 — 3 agents already exist with Champz API keys from prior work; signer keys being generated now.)
- [ ] Confirm the exact Sibyl SDK programmatic call surface (importable Python functions vs. CLI-only) — swap the bridge's JSON-file stub for the real thing once confirmed.
- [ ] Replace `reasoning.ts`'s placeholder deterministic baseline with the real OpenRouter call + prompt.
- [ ] Wire a real on-chain transfer for the funding step (Step 6 above) through the ACP provider's `sendTransaction`, instead of printed human instructions — deferred as a "later" item during planning.
