"""
Read-only MCP server for the Champz AI Arena agent API — lets Claude Desktop
self-serve live cycle state and this agent's own outcome history, instead of
a human relaying JSON between Virtuals chat and Claude Desktop by hand.

Exposes 4 read-only tools:
  - get_upcoming_cycle   the next cycle's chain/token/price/deadline
  - get_cycle_state      live state of a cycle this agent is enrolled in
  - get_my_history       this agent's full strategy + outcome history
  - get_sibyl_identity   this agent's real Sibyl Memory account identity
                         (tier, masked email, short tenant id) — same data
                         the `sibyl whoami` CLI shows, via the real SDK's
                         health() call, so the demo doesn't need a
                         dedicated terminal open just for that one beat.

No write/mutating endpoints on purpose — enroll/submit/withdraw stay in
Virtuals chat, since that's the beat that needs to be visibly, genuinely
performed through Virtuals for the partner-multiplier story. This server
only removes the *plumbing* hops (a human copy-pasting data Claude Desktop
needs but has no way to fetch itself), not the load-bearing ones.

This is the actual file used during the live demo, with one change: the API
key is now read from an environment variable (CHAMPZ_AGENT_API_KEY — the
same key `agent/` uses, from the one-time register step) instead of being
hardcoded, so this version is safe to publish. See ../.env.example.
Launched by Claude Desktop itself via its MCP config (command + args, stdio
transport).
"""

import os
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP
from sibyl_memory_hermes import SibylMemoryProvider

BASE = "https://api.champz.world/game/spore-trainer/ai-agent"
API_KEY = os.environ["CHAMPZ_AGENT_API_KEY"]

# Cycle 66 was an old test enrollment (50/40 spend/price config, never even
# entered) — not part of the controlled 76-79 data-collection set. Filtered
# out here, in our own wrapper, rather than in the live backend endpoint,
# which stays generic/correct for any other consumer.
MIN_CYCLE_ID = 76

# /my-history's decision fields/text are hardcoded from an older USDC-only
# assumption in the backend's scoring engine — never updated when VIRTUAL-
# token cycles were added. Every Arena_AI_Master cycle actually runs on
# Base with VIRTUAL (confirmed via real cycle-state/upcoming-cycle data,
# never USDC) — relabeled here rather than in the backend, since that field
# naming is a broader legacy thing other consumers may still depend on.
ACTUAL_TOKEN = "VIRTUAL"


def _fix_token_labeling(cycle: dict[str, Any]) -> dict[str, Any]:
    fixed_decisions = []
    for d in cycle.get("decisions", []):
        d = dict(d)
        if "usdc_price" in d:
            d["price"] = d.pop("usdc_price")
        if isinstance(d.get("reason"), str):
            d["reason"] = d["reason"].replace("USDC", ACTUAL_TOKEN)
        fixed_decisions.append(d)
    cycle = dict(cycle)
    cycle["decisions"] = fixed_decisions
    cycle["token"] = ACTUAL_TOKEN
    return cycle

mcp = FastMCP("champz-arena-readonly")
_sibyl = SibylMemoryProvider()


def _mask_email(email: str) -> str:
    try:
        local, domain = email.split("@", 1)
        domain_name, _, tld = domain.rpartition(".")
        return f"{local[0]}***@{domain_name[0]}***.{tld}"
    except Exception:
        return "***"


def _get(path: str) -> dict[str, Any]:
    resp = httpx.get(f"{BASE}{path}", headers={"X-API-Key": API_KEY}, timeout=15.0)
    resp.raise_for_status()
    return resp.json()


@mcp.tool()
def get_upcoming_cycle() -> dict[str, Any]:
    """Get the next Champz AI Arena cycle Arena_AI_Master can enroll in:
    chain, token, starting_price, price_multiplier, strategy_deadline,
    slots. Live current-cycle state, not memory — safe to feed into
    reasoning alongside recalled history."""
    return _get("/upcoming-cycle")


@mcp.tool()
def get_cycle_state() -> dict[str, Any]:
    """Get live state of the cycle Arena_AI_Master is currently enrolled in
    (if any): current guardian, price, leaderboard, time remaining. Useful
    for narrating a cycle while it's running."""
    return _get("/cycle-state")


@mcp.tool()
def get_my_history() -> dict[str, Any]:
    """Get Arena_AI_Master's history from cycle 76 onward (the controlled
    data-collection set — earlier test cycles are filtered out here): every
    cycle it enrolled in, the strategy submitted, every buy/skip decision
    with the engine's actual scoring reasoning, total_paid, reward_earned,
    won, hold_duration_seconds, entry_price, entry_timing_pct. All prices
    are in VIRTUAL, not USDC — the backend's decision-reasoning text and
    field names are mislabeled from an older USDC-only assumption; relabeled
    here to the actual token. This is the source data for the REMEMBER step
    — reasoning should never call this directly (see the architecture note
    in docs/ARCHITECTURE.md: reasoning must only ever see Sibyl recall +
    live cycle state, so deleting Sibyl actually breaks something)."""
    data = _get("/my-history")
    cycles = [_fix_token_labeling(c) for c in data.get("cycles", []) if c.get("cycle_id", 0) >= MIN_CYCLE_ID]
    data["cycles"] = cycles
    data["token"] = ACTUAL_TOKEN
    data["summary"] = {
        "total_cycles": len(cycles),
        "cycles_won": sum(1 for c in cycles if c.get("won")),
        "total_spent": round(sum(c.get("total_paid", 0) for c in cycles), 6),
        "total_earned": round(sum(c.get("reward_earned", 0) for c in cycles), 2),
    }
    return data


@mcp.tool()
def get_sibyl_identity() -> dict[str, Any]:
    """Get this agent's real, registered Sibyl Memory account identity:
    tier (e.g. 'stake'), a masked email, and a short tenant id — the same
    information the `sibyl whoami` CLI command shows. Real proof this
    memory layer is backed by a genuine paid Sibyl account, not a stub."""
    h = _sibyl.health()
    tenant_id = h.get("tenant_id", "")
    short_id = f"{tenant_id[:8]}…{tenant_id[-4:]}" if len(tenant_id) > 12 else tenant_id
    return {
        "ok": h.get("ok", False),
        "tenant_id": short_id,
        "tier": h.get("tier"),
        "email": _mask_email(h.get("email", "")),
        "hermes_bound": h.get("hermes_bound"),
    }


if __name__ == "__main__":
    mcp.run()
