"""AI features beyond outreach: natural-language lead search and the pipeline brief.

Both follow the same contract as the Outreach Copilot: the model only sees data we hand it, answers in a
strict JSON schema, and a deterministic implementation takes over whenever no provider is available.
"""

import json
import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Lead
from app.services import leads as lead_svc
from app.services.activity import action_center
from app.services.llm import LLMUnavailable, generate_json
from app.services.normalize import US_STATES
from app.services.scoring import next_best_action

log = logging.getLogger(__name__)

TIERS = ("hot", "warm", "cold")
STAGES = ("new", "contacted", "replied", "meeting", "won", "lost")
SORTS = ("-score", "score", "-created_at", "company_name", "-revenue_usd", "-employee_count", "founded_year")

# ---------------------------------------------------------------------------------------------- search

SEARCH_SYSTEM = """You translate a dealmaker's plain-English request into filters for a lead database.

Only use values from the allowed lists in the schema. Map synonyms to the closest allowed value (for example
"heating and cooling" -> HVAC, "Texas" -> TX, "untouched" or "not contacted yet" -> stage new, "best" or
"strongest" -> tier hot). Leave a filter empty when the request does not mention it - never guess. Put any
remaining distinctive words (a company name, "family owned", a city) in keywords. The explanation is one short
sentence describing the filters you applied, written for the user."""


def _search_schema(industries: list[str], states: list[str]) -> dict[str, Any]:
    def str_array(allowed: list[str] | tuple[str, ...]) -> dict[str, Any]:
        items: dict[str, Any] = {"type": "string"}
        if allowed:
            items["enum"] = list(allowed)
        return {"type": "array", "items": items}

    return {
        "type": "object",
        "properties": {
            "tiers": str_array(TIERS),
            "stages": str_array(STAGES),
            "industries": str_array(industries),
            "states": str_array(states),
            "min_score": {"type": "integer", "description": "0 when not mentioned"},
            "has_email": {"type": "boolean"},
            "follow_up_due": {"type": "boolean"},
            "keywords": {"type": "string", "description": "Free-text search, empty string when not needed"},
            "sort": {"type": "string", "enum": list(SORTS)},
            "explanation": {"type": "string"},
        },
        "required": ["tiers", "stages", "industries", "states", "min_score", "has_email", "follow_up_due",
                     "keywords", "sort", "explanation"],
        "additionalProperties": False,
    }


def _clean_filters(raw: dict[str, Any], industries: list[str], states: list[str]) -> dict[str, Any]:
    """Never trust model output blindly: keep only allowed values so the UI can apply filters as-is."""
    by_lower = {i.lower(): i for i in industries}
    min_score = raw.get("min_score") or 0
    return {
        "tiers": [t for t in raw.get("tiers", []) if t in TIERS],
        "stages": [s for s in raw.get("stages", []) if s in STAGES],
        "industries": [by_lower[i.lower()] for i in raw.get("industries", []) if i.lower() in by_lower],
        "states": [s.upper() for s in raw.get("states", []) if s.upper() in states],
        "min_score": max(0, min(100, int(min_score))) if isinstance(min_score, (int, float)) else 0,
        "has_email": bool(raw.get("has_email")),
        "follow_up_due": bool(raw.get("follow_up_due")),
        "keywords": str(raw.get("keywords") or "").strip()[:100],
        "sort": raw.get("sort") if raw.get("sort") in SORTS else "-score",
    }


def rule_based_search(query: str, industries: list[str], states: list[str]) -> dict[str, Any]:
    """Keyword parser used when no AI provider is available. Handles the common phrasings."""
    q = query.lower()
    words = set(re.findall(r"[a-z]+", q))
    f: dict[str, Any] = {"tiers": [t for t in TIERS if t in words], "stages": [], "industries": [], "states": [],
                         "min_score": 0, "has_email": False, "follow_up_due": False, "keywords": "", "sort": "-score"}
    if words & {"best", "strongest", "top"} and not f["tiers"]:
        f["tiers"] = ["hot"]
    if re.search(r"not (been )?contacted|untouched|haven'?t (contacted|reached)|never contacted", q):
        f["stages"] = ["new"]
    else:
        f["stages"] = [s for s in STAGES if s in words and s != "new"]
    for ind in industries:
        il = ind.lower()
        if il in q or (len(il.split()[0]) > 3 and il.split()[0] in words):
            f["industries"].append(ind)
    for name, abbr in US_STATES.items():
        if abbr in states and re.search(rf"\b{re.escape(name)}\b", q) and abbr not in f["states"]:
            f["states"].append(abbr)
    for token in re.findall(r"\b[A-Z]{2}\b", query):  # uppercase only, so "in"/"or" never match Indiana/Oregon
        if token in states and token not in f["states"]:
            f["states"].append(token)
    if m := re.search(r"(?:score|above|over|at least|>=?)\s*(?:of\s*)?(\d{2,3})", q):
        f["min_score"] = min(100, int(m.group(1)))
    f["has_email"] = bool(words & {"email", "emails", "reachable"})
    f["follow_up_due"] = bool(re.search(r"overdue|follow[- ]?ups? (are )?due|due (today|now)", q))
    if words & {"oldest"}:
        f["sort"] = "founded_year"
    elif words & {"biggest", "largest"} or "most employees" in q:
        f["sort"] = "-employee_count"
    elif "revenue" in words:
        f["sort"] = "-revenue_usd"
    elif words & {"newest", "latest", "recent"}:
        f["sort"] = "-created_at"
    return f


def describe(f: dict[str, Any]) -> str:
    parts = []
    if f["tiers"]:
        parts.append(" / ".join(f["tiers"]) + " leads")
    if f["industries"]:
        parts.append("in " + ", ".join(f["industries"]))
    if f["states"]:
        parts.append("located in " + ", ".join(f["states"]))
    if f["stages"]:
        parts.append("at stage " + ", ".join(f["stages"]))
    if f["min_score"]:
        parts.append(f"scoring {f['min_score']}+")
    if f["has_email"]:
        parts.append("with an email on file")
    if f["follow_up_due"]:
        parts.append("with a follow-up due")
    if f["keywords"]:
        parts.append(f'matching "{f["keywords"]}"')
    return ("Showing " + " ".join(parts) + ".") if parts else "No specific filters recognised - showing all leads by score."


async def ai_search(db: Session, query: str) -> dict[str, Any]:
    facets = {
        "industries": list(db.scalars(select(Lead.industry).where(Lead.industry.is_not(None)).distinct()).all()),
        "states": list(db.scalars(select(Lead.state).where(Lead.state.is_not(None)).distinct()).all()),
    }
    if get_settings().ai_enabled:
        try:
            raw, model = await generate_json(
                SEARCH_SYSTEM,
                f"ALLOWED INDUSTRIES: {facets['industries']}\nALLOWED STATES: {facets['states']}\n\nREQUEST: {query}",
                _search_schema(facets["industries"], facets["states"]),
                name="lead_filters",
                max_tokens=1000,
            )
            filters = _clean_filters(raw, facets["industries"], facets["states"])
            explanation = str(raw.get("explanation") or "").strip() or describe(filters)
            return {"filters": filters, "explanation": explanation, "generator": model}
        except (LLMUnavailable, AttributeError, TypeError, ValueError) as exc:
            log.warning("AI search unavailable (%s); using keyword parser", exc)
    filters = rule_based_search(query, facets["industries"], facets["states"])
    return {"filters": filters, "explanation": describe(filters), "generator": "rules"}


# ----------------------------------------------------------------------------------------------- brief

BRIEF_SYSTEM = """You are the chief of staff for a search fund / private-equity deal team. Write a short
morning brief about their lead pipeline. Use ONLY the numbers and companies in the PIPELINE DATA - never invent
figures, companies, or events. Be specific: name companies and cite their scores. Each insight must lead to an
action. Plain text, no markdown, no emojis. lead_id is the id of the company an insight is about, or 0."""

BRIEF_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "headline": {"type": "string", "description": "One sentence, under 20 words"},
        "insights": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Under 8 words"},
                    "detail": {"type": "string", "description": "1-2 sentences ending in an action"},
                    "lead_id": {"type": "integer"},
                },
                "required": ["title", "detail", "lead_id"],
                "additionalProperties": False,
            },
        },
        "focus_today": {"type": "string", "description": "The single most valuable thing to do today"},
    },
    "required": ["headline", "insights", "focus_today"],
    "additionalProperties": False,
}


def pipeline_snapshot(db: Session) -> dict[str, Any]:
    stats = lead_svc.stats(db)
    actions = action_center(db, limit=5)
    open_leads = db.scalars(
        select(Lead).where(Lead.stage.in_(["new", "contacted", "replied", "meeting"])).order_by(Lead.score.desc()).limit(8)
    ).all()
    return {
        "totals": {k: stats[k] for k in ("total", "enriched", "with_email", "avg_score")},
        "by_tier": stats["by_tier"],
        "by_stage": stats["by_stage"],
        "by_industry": stats["by_industry"][:6],
        "follow_ups_due": [{k: c[k] for k in ("id", "company_name", "score", "stage", "days_overdue")}
                           for c in actions["follow_ups_due"]],
        "hot_untouched": [{k: c[k] for k in ("id", "company_name", "industry", "state", "score")}
                          for c in actions["hot_untouched"]],
        "top_open_leads": [
            {"id": l.id, "company_name": l.company_name, "industry": l.industry, "state": l.state, "score": l.score,
             "tier": l.score_tier, "stage": l.stage, "next_action": next_best_action(l)}
            for l in open_leads
        ],
    }


def rule_based_brief(snap: dict[str, Any]) -> dict[str, Any]:
    t, tiers = snap["totals"], snap["by_tier"]
    insights: list[dict[str, Any]] = []
    if due := snap["follow_ups_due"]:
        worst = max(due, key=lambda c: c["days_overdue"])
        insights.append({"title": f"{len(due)} follow-up{'s' if len(due) > 1 else ''} overdue",
                         "detail": f"{worst['company_name']} is {worst['days_overdue']} day(s) overdue. "
                                   "Send the follow-up before the conversation goes cold.",
                         "lead_id": worst["id"]})
    if hot := snap["hot_untouched"]:
        top = hot[0]
        insights.append({"title": f"{len(hot)} hot leads never contacted",
                         "detail": f"Start with {top['company_name']} (score {top['score']}). "
                                   "Generate an intro with the AI Copilot.",
                         "lead_id": top["id"]})
    if snap["by_industry"]:
        best = max(snap["by_industry"], key=lambda i: i["avg_score"])
        insights.append({"title": f"{best['industry']} fits your thesis best",
                         "detail": f"Average Deal Signal of {round(best['avg_score'])} across {best['count']} leads. "
                                   "Source more companies in this vertical.",
                         "lead_id": 0})
    missing = t["total"] - t["with_email"]
    if missing > 0:
        insights.append({"title": f"{missing} leads have no email",
                         "detail": "Re-run enrichment or add a contact manually so they can enter outreach.",
                         "lead_id": 0})
    focus = insights[0]["detail"] if insights else "Import or add companies to start building your pipeline."
    return {
        "headline": f"{tiers.get('hot', 0)} hot leads out of {t['total']}, averaging a Deal Signal of {round(t['avg_score'])}.",
        "insights": insights[:4],
        "focus_today": focus,
        "generator": "rules",
    }


async def pipeline_brief(db: Session) -> dict[str, Any]:
    snap = pipeline_snapshot(db)
    if get_settings().ai_enabled:
        try:
            data, model = await generate_json(
                BRIEF_SYSTEM, f"PIPELINE DATA (JSON):\n{json.dumps(snap, indent=2, default=str)}\n\nWrite the brief.",
                BRIEF_SCHEMA, name="pipeline_brief", max_tokens=1500,
            )
            valid_ids = {c["id"] for key in ("follow_ups_due", "hot_untouched", "top_open_leads") for c in snap[key]}
            insights = [
                {"title": str(i["title"]).strip(), "detail": str(i["detail"]).strip(),
                 "lead_id": i["lead_id"] if i.get("lead_id") in valid_ids else 0}
                for i in data.get("insights", [])[:4]
            ]
            if insights:
                return {"headline": str(data["headline"]).strip(), "insights": insights,
                        "focus_today": str(data["focus_today"]).strip(), "generator": model}
        except (LLMUnavailable, KeyError, AttributeError, TypeError) as exc:
            log.warning("AI brief unavailable (%s); using rule-based brief", exc)
    return rule_based_brief(snap)
