# Champz Arena Memory Agent

A Virtuals Protocol EconomyOS agent that competes in the [Champz AI Arena](https://legends.champz.world/aiarena) — a live, on-chain "Guardian Throne" competition on Base — with **persistent memory across cycles**, powered by [Sibyl Memory](https://sibyllabs.org).

Built for the [Sibyl Memory Hackathon](https://hack.sibyllabs.org).

## Why this exists

Most competitive on-chain agents reason fresh every time: same inputs in, same kind of decision out, no matter how many times they've played before. This agent is different — before it decides how aggressively to compete in a new Champz Arena cycle, it recalls its own history from previous cycles (entry price vs. the eventual winning price, how early/late it entered, whether it overpaid) and lets that genuinely change its strategy. Delete the memory layer and the agent still runs — but it stops learning from its own past mistakes.

## How it works

1. **Register once** — the agent's own wallet (a Virtuals ACP-provisioned smart account) signs the arena's registration challenge (`GET /register/challenge` → `POST /register`), getting back an API key and an execution wallet to fund.
2. **Recall** — before reasoning about a new cycle, the agent queries Sibyl Memory for its own outcome history: past entry prices vs. the eventual winner, timing, wins/losses, price-escalation patterns it has observed.
3. **Check the upcoming cycle & enroll** — chain, token, starting price, price multiplier, prize seed, slots, and the strategy deadline (`GET /upcoming-cycle`), then `POST /enroll` for a slot.
4. **Reason** — recalled memory + this cycle's live state get turned into the arena's actual strategy shape: 10 numeric thresholds (risk tolerance, entry timing, purchase threshold, spend caps, escalation tolerance, etc.) — the same parameter shape Champz's own decision engine already understands. The recalled memory is what should shift these numbers cycle to cycle, not the raw inputs alone. (See "Demo vs. reference implementation" below for exactly how this step is performed.)
5. **Submit** the reasoned thresholds before the strategy deadline (`POST /strategy`). From there, Champz's existing cycle executor makes every tick-by-tick buy decision autonomously from those thresholds — the same shared engine that drives every mode of the arena, real and practice alike. Nothing here is a backend button-press on our side, and nothing here needs a live polling loop during the cycle either.
6. **Remember** — once the cycle settles, the outcome (price paid, timing, result, opponents faced) is written back to Sibyl Memory, so the *next* fresh session has something real to recall. Rewards arrive automatically on-chain; no manual claim needed in the normal case.

## Architecture

```
agent/          Node/TypeScript — ACP wallet identity + signing
                 (@virtuals-protocol/acp-node-v2), Champz AI Arena API
                 client, LLM-driven reasoning loop
sibyl-bridge/    Python/FastAPI — thin wrapper around the Sibyl Memory
                 SDK, exposing /remember and /recall over local HTTP
mcp-servers/     Python/FastMCP — champz_arena_readonly_mcp.py, the actual
                 read-only MCP server used in the live demo (API key now
                 read from an env var instead of hardcoded, so it's safe
                 to publish)
```

Sibyl Memory's documented integration surface is a Python CLI/SDK; the current ACP SDK is Node/TypeScript. Rather than force one language to do both jobs, the agent's reasoning process (Node) talks to a small local Sibyl bridge (Python) over HTTP. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design, the exact API flow (register → enroll → fund → submit strategy → settle), and the reasoning behind it.

**Where memory is actually read and written** (critical-path, not decorative): [`sibyl-bridge/app.py`](sibyl-bridge/app.py) — `remember()` (line 60) writes each cycle's real outcome to Sibyl after settlement; `recall()` (line 71) reads that history back before every reasoning step. Delete the underlying Sibyl memory and `recall()` returns nothing to reason from — this is the exact call our live demo deletes memory in front of, on camera.

**Partner stacks, exercised live in the demo, not just claimed:**
- **Base** — the agent's execution wallet is funded via a real, on-chain transaction through Base MCP, approved by hand in the Base Account app (shown in the demo video).
- **Virtuals** — a registered ACP agent (`@virtuals-protocol/acp-node-v2`), competing through Virtuals' own agent chat for every write action (enroll, submit strategy, withdraw) — shown live in the demo.

## Demo vs. reference implementation

`agent/` and `sibyl-bridge/` are a full, tested, standalone implementation of this loop — real ACP wallet identity (`@virtuals-protocol/acp-node-v2`), a live-verified client for every Champz AI Arena endpoint, and a real Sibyl Memory integration. Every mechanical step — registration, recall, cycle-checking, enrollment, and remembering outcomes — can run unattended, no human in the loop. The one deliberate exception is reasoning itself: turning recalled memory and live cycle state into an actual strategy decision happens live, through real tool use, not a scripted LLM call baked into the codebase — so the reasoning stays genuinely inspectable rather than hidden inside a black-box function.

For the recorded demo specifically, the same underlying integrations are instead driven live, on camera, through two real partner products rather than a background script: **Claude Desktop** — connected to Base MCP for funding, Sibyl's own official `sibyl-memory-mcp` server for `memory_remember`/`memory_recall`/`memory_list`/`memory_forget` (directly against the same real Sibyl account this repo's bridge talks to), and [`mcp-servers/champz_arena_readonly_mcp.py`](mcp-servers/champz_arena_readonly_mcp.py), a small custom read-only MCP server we built for live cycle-state and outcome-history lookups — handles memory and reasoning; **Virtuals' own agent chat** handles every write action (check cycle, enroll, submit, withdraw). Same registered ACP wallet, same arena API, same Sibyl account either way — the demo just makes the integration watchable and independently verifiable by routing it through the partner products themselves instead of hiding it inside a script. Full technical detail in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#two-surface-demo-architecture-the-actual-live-demo-runtime).

## Reference

The full agent-facing API runbook this client implements is Champz's own `VIRTUALS_CUSTOM_FUNCTIONS.md` — the same document handed to any EconomyOS agent over ACP chat to onboard itself into the arena.

## Prior work

One commit predates the official Sep 1 build window: the initial repo scaffold (`13db816`, Aug 17 — license and folder structure, no working integrations). Every functional piece — the Champz Arena API client, ACP wallet wiring, the Sibyl Memory integration, the two-surface demo architecture, all data-collection and demo cycles, and the article/video — was built during the Sep 1–10 window. See the repo's commit history for the exact chronology; timestamps are real, not backdated.

## Status

✅ Built during the Sibyl Memory Hackathon build window (Sep 1–10, 2026). The real memory-informed A/B demo is complete — Cycle 80 (with memory) vs. Cycle 82 (without), run for real on Base and honestly compared. See `docs/ARCHITECTURE.md` for architecture detail; demo video and full writeup links to follow.

## License

MIT — see [LICENSE](LICENSE).
