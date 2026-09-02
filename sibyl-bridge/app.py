"""
Sibyl Memory bridge — thin HTTP wrapper the Node agent talks to.

Backed by the real Sibyl Memory SDK (sibyl_memory_hermes.SibylMemoryProvider),
confirmed directly against the installed package on this machine (not
guessed): `remember(category, name, body, *, status=None)` stores one record
per key, `list(category=...)` returns every record under that category. Each
Champz Arena agent gets its own category (`champz-arena:{agentId}`); each
cycle outcome is one record (`cycle-{cycleId}`) within it. `/recall` reads
every past record for the agent and folds it into a compact summary the
reasoning step can drop straight into an LLM prompt.

Requires `sibyl init` to have been run once on this machine (browser/email
sign-in, stores credentials at ~/.sibyl-memory/credentials.json) — the
provider auto-loads those credentials by default.
"""

from typing import Optional

from fastapi import FastAPI
from pydantic import BaseModel
from sibyl_memory_hermes import SibylMemoryProvider

app = FastAPI(title="sibyl-bridge")

provider = SibylMemoryProvider()

CATEGORY_PREFIX = "champz-arena"


def _category(agent_id: str) -> str:
    return f"{CATEGORY_PREFIX}:{agent_id}"


class CycleMemoryEntry(BaseModel):
    """
    Matches what GET /my-history actually returns per cycle, plus the derived
    roiPct that the success metric is built on. Success is measured by ROI on
    spend (reward_earned vs total_paid), NOT win/loss — max_spend_per_cycle and
    max_price_per_purchase stay fixed across every cycle on purpose, so only
    the judgment params (entryTiming, purchaseThreshold, riskTolerance, the
    deterrents, randomFactor) are the thing memory should ever be changing.
    """
    agentId: str
    cycleId: int
    strategy: dict  # the 10 submitted strategy params for this cycle
    totalPaid: float
    rewardEarned: float
    roiPct: float
    won: bool
    holdDurationSeconds: int
    entryPrice: Optional[float] = None
    entryTimingPct: Optional[float] = None
    competitorCount: Optional[int] = None
    topCompetitorHoldSeconds: Optional[int] = None
    notes: Optional[str] = None


@app.post("/remember")
def remember(entry: CycleMemoryEntry):
    provider.remember(
        category=_category(entry.agentId),
        name=f"cycle-{entry.cycleId}",
        body=entry.model_dump(),
        status=f"roi_{round(entry.roiPct)}",
    )
    return {"success": True}


@app.get("/recall")
def recall(agentId: str):
    records = provider.list(category=_category(agentId))
    entries = [r["body"] for r in records]

    if not entries:
        return {
            "agentId": agentId,
            "cycleCount": 0,
            "summary": "No prior cycles recorded for this agent.",
            "entries": [],
        }

    avg_roi = sum(e["roiPct"] for e in entries) / len(entries)
    best = max(entries, key=lambda e: e["roiPct"])
    worst = min(entries, key=lambda e: e["roiPct"])
    early_entries = [e for e in entries if (e.get("entryTimingPct") or 100) < 20]
    late_entries = [e for e in entries if (e.get("entryTimingPct") or 0) >= 50]

    summary_parts = [
        f"{len(entries)} cycle(s) recorded, average ROI {avg_roi:.0f}%.",
        f"Best: cycle {best['cycleId']} at {best['roiPct']:.0f}% ROI "
        f"(entry_timing={best['strategy'].get('entry_timing')}, "
        f"risk_tolerance={best['strategy'].get('risk_tolerance')}).",
        f"Worst: cycle {worst['cycleId']} at {worst['roiPct']:.0f}% ROI "
        f"(entry_timing={worst['strategy'].get('entry_timing')}, "
        f"risk_tolerance={worst['strategy'].get('risk_tolerance')}).",
    ]
    if early_entries and late_entries:
        early_avg = sum(e["roiPct"] for e in early_entries) / len(early_entries)
        late_avg = sum(e["roiPct"] for e in late_entries) / len(late_entries)
        summary_parts.append(
            f"Early entries (<20% into cycle) averaged {early_avg:.0f}% ROI vs "
            f"{late_avg:.0f}% for late entries (>=50%)."
        )

    return {
        "agentId": agentId,
        "cycleCount": len(entries),
        "summary": " ".join(summary_parts),
        "entries": entries,
    }


@app.get("/health")
def health():
    return provider.health()
