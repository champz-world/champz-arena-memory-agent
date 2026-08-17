"""
Sibyl Memory bridge — thin HTTP wrapper the Node agent talks to.

STATUS: the /remember and /recall endpoints below currently persist to a local
JSON file, NOT Sibyl Memory. This is deliberate: it lets the agent <-> bridge
HTTP contract get built and tested immediately, without blocking on the first
research spike (confirming Sibyl's real Python programmatic call surface —
see docs/ARCHITECTURE.md open items).

Swap-in point: replace `_load_store()` / `_save_store()` below with real calls
into the Sibyl SDK (or subprocess calls to the `sibyl` CLI if no clean import
exists). The route handlers and their request/response shapes should not need
to change.
"""

import json
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="sibyl-bridge")

STORE_PATH = Path(__file__).parent / ".memory_store.json"


class CycleMemoryEntry(BaseModel):
    agentId: str
    cycleId: int
    entryPrice: Optional[float] = None
    entryTimingPct: Optional[float] = None
    outcome: str  # "won" | "lost" | "no_entry"
    winningPrice: Optional[float] = None
    opponents: list[str] = []
    notes: Optional[str] = None


def _load_store() -> dict:
    if not STORE_PATH.exists():
        return {}
    return json.loads(STORE_PATH.read_text())


def _save_store(store: dict) -> None:
    STORE_PATH.write_text(json.dumps(store, indent=2))


@app.post("/remember")
def remember(entry: CycleMemoryEntry):
    store = _load_store()
    store.setdefault(entry.agentId, []).append(entry.model_dump())
    _save_store(store)
    return {"success": True}


@app.get("/recall")
def recall(agentId: str):
    store = _load_store()
    entries = store.get(agentId, [])

    if not entries:
        return {
            "agentId": agentId,
            "cycleCount": 0,
            "summary": "No prior cycles recorded for this agent.",
            "entries": [],
        }

    wins = sum(1 for e in entries if e["outcome"] == "won")
    losses = sum(1 for e in entries if e["outcome"] == "lost")
    overpays = [
        e for e in entries
        if e.get("entryPrice") and e.get("winningPrice") and e["entryPrice"] > e["winningPrice"]
    ]

    summary_parts = [f"{len(entries)} cycle(s) recorded ({wins} won, {losses} lost)."]
    if overpays:
        summary_parts.append(
            f"Overpaid relative to the eventual winning price in {len(overpays)} of them."
        )

    return {
        "agentId": agentId,
        "cycleCount": len(entries),
        "summary": " ".join(summary_parts),
        "entries": entries,
    }


@app.get("/health")
def health():
    return {"status": "ok"}
