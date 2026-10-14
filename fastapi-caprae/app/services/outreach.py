"""AI Outreach Copilot: grounded, personalized first-touch messaging for a lead.

Uses Claude with a strict JSON schema so the UI always gets the same shape. Every claim must come
from the lead's scraped facts (no hallucinated "I loved your recent award" lines). When no API key is
configured - or the API is unavailable - a deterministic template generator keeps the feature usable.
"""

import json
import logging
from dataclasses import asdict, dataclass
from typing import Any

import anthropic

from app.core.config import get_settings
from app.services.scoring import years_in_business

log = logging.getLogger(__name__)

GOALS = {
    "acquisition": "a search-fund / private-equity buyer reaching out to a business owner about a potential "
                   "acquisition or succession partnership",
    "sales": "a B2B seller reaching out to a decision maker about a product or service that solves a likely pain",
    "partnership": "a company proposing a mutually beneficial referral or channel partnership",
}
TONES = ("warm", "direct", "formal", "casual")

OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "subject": {"type": "string", "description": "Email subject line, under 60 characters, no clickbait"},
        "email_body": {"type": "string", "description": "Plain-text email, 90-150 words, ends with a soft, specific ask"},
        "linkedin_note": {"type": "string", "description": "LinkedIn connection note, under 280 characters"},
        "call_opener": {"type": "string", "description": "2-3 sentence cold-call opener"},
        "follow_up": {"type": "string", "description": "Short follow-up email for 3-4 days later, under 80 words"},
        "personalization_points": {
            "type": "array",
            "items": {"type": "string"},
            "description": "The specific facts from the lead data that were used to personalize",
        },
    },
    "required": ["subject", "email_body", "linkedin_note", "call_opener", "follow_up", "personalization_points"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """You write first-touch outreach for lower-middle-market business development.

Ground every personalized detail in the LEAD FACTS provided. If a fact is not in the data, do not
mention it - never invent awards, news, revenue figures, or names. If the owner's name is unknown,
use a natural greeting without a name ("Hi there," or "Hello,"). Write like a thoughtful human: concise,
specific, respectful of the owner's time, no buzzwords, no exclamation marks, no emojis. Acquisition
outreach to founders must be especially respectful: emphasize legacy, employees, and continuity rather
than "buying" the company. Plain text only - no markdown. Use [Your Name] as the sender placeholder."""


@dataclass
class OutreachResult:
    subject: str
    email_body: str
    linkedin_note: str
    call_opener: str
    follow_up: str
    personalization_points: list[str]
    generator: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def lead_facts(lead: Any) -> dict[str, Any]:
    sig = lead.signals or {}
    yib = years_in_business(lead.founded_year)
    best_email = next((e["email"] for e in (lead.emails or []) if e.get("status") == "valid"), None)
    facts = {
        "company_name": lead.company_name,
        "website": lead.website,
        "industry": lead.industry,
        "location": ", ".join(p for p in (lead.city, lead.state) if p) or None,
        "description": (lead.description or "")[:600] or None,
        "owner_name": lead.owner_name,
        "owner_title": lead.owner_title,
        "employees": lead.employee_count,
        "founded_year": lead.founded_year,
        "years_in_business": yib,
        "family_owned": sig.get("family_owned") or None,
        "generation": sig.get("generation"),
        "veteran_owned": sig.get("veteran_owned") or None,
        "woman_owned": sig.get("woman_owned") or None,
        "hiring": sig.get("hiring") or None,
        "tech_stack": lead.tech_stack or None,
        "has_email_contact": bool(best_email),
    }
    return {k: v for k, v in facts.items() if v not in (None, "", [], False)}


async def generate_outreach(lead: Any, goal: str, tone: str, sender_context: str | None) -> OutreachResult:
    goal = goal if goal in GOALS else "acquisition"
    tone = tone if tone in TONES else "warm"
    settings = get_settings()
    if settings.ai_enabled:
        try:
            return await _generate_with_claude(lead, goal, tone, sender_context)
        except anthropic.APIConnectionError:
            log.warning("Claude unreachable; using template outreach")
        except anthropic.RateLimitError:
            log.warning("Claude rate limited; using template outreach")
        except anthropic.APIStatusError as exc:
            log.warning("Claude API error %s; using template outreach", exc.status_code)
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            log.warning("Unusable Claude response (%s); using template outreach", exc)
    return template_outreach(lead, goal, tone, sender_context)


async def _generate_with_claude(lead: Any, goal: str, tone: str, sender_context: str | None) -> OutreachResult:
    settings = get_settings()
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=60.0, max_retries=2)
    user_prompt = (
        f"GOAL: You are {GOALS[goal]}.\nTONE: {tone}.\n"
        f"SENDER CONTEXT: {sender_context or 'Not provided - keep the sender generic.'}\n\n"
        f"LEAD FACTS (JSON):\n{json.dumps(lead_facts(lead), indent=2)}\n\n"
        "Write the outreach package."
    )
    response = await client.beta.messages.create(
        model=settings.anthropic_model,
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
        # Server-side fallback: if a safety classifier declines, the API re-runs on a recommended model.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    if response.stop_reason == "refusal":
        raise ValueError("Model declined the request")
    if response.stop_reason == "max_tokens":
        raise ValueError("Response truncated")
    text = next((b.text for b in response.content if b.type == "text"), None)
    if not text:
        raise ValueError("No text block in response")
    data = json.loads(text)
    return OutreachResult(
        subject=data["subject"].strip(),
        email_body=data["email_body"].strip(),
        linkedin_note=data["linkedin_note"].strip()[:300],
        call_opener=data["call_opener"].strip(),
        follow_up=data["follow_up"].strip(),
        personalization_points=[str(p) for p in data.get("personalization_points", [])][:8],
        generator=response.model,
    )


def template_outreach(lead: Any, goal: str, tone: str, sender_context: str | None) -> OutreachResult:
    f = lead_facts(lead)
    name = (lead.owner_name or "").split(" ")[0] if lead.owner_name else None
    greet = {"formal": f"Dear {lead.owner_name}," if lead.owner_name else "Hello,",
             "casual": f"Hey {name}," if name else "Hey there,"}.get(tone, f"Hi {name}," if name else "Hi there,")
    company = lead.company_name
    points: list[str] = []
    hooks: list[str] = []
    if f.get("years_in_business"):
        hooks.append(f"{f['years_in_business']} years of serving {f.get('location') or 'your community'}")
        points.append(f"Founded {f['founded_year']}")
    if f.get("family_owned"):
        hooks.append("a family-owned reputation" + (f" now in its {f['generation']} generation" if f.get("generation") else ""))
        points.append("Family-owned")
    if f.get("industry"):
        points.append(f"Industry: {f['industry']}")
    if f.get("hiring"):
        points.append("Currently hiring")
    hook = " and ".join(hooks[:2]) if hooks else f"the work {company} does in {f.get('industry') or 'your space'}"
    sender = sender_context or "[Your Name]"

    if goal == "acquisition":
        subject = f"{company} - continuity and legacy"
        body = (
            f"{greet}\n\n"
            f"I came across {company} and was impressed by {hook}. I'm {sender}, and I work with owners of "
            f"established {f.get('industry') or 'service'} businesses who are starting to think about what's next - "
            f"whether that's retirement, stepping back from day-to-day operations, or bringing in a partner to grow.\n\n"
            f"My focus is on preserving what owners have built: the team, the customers, and the name on the door. "
            f"There's no pressure or timeline here.\n\n"
            f"Would you be open to a 15-minute conversation in the next couple of weeks?\n\n"
            f"Best,\n[Your Name]"
        )
        follow = (f"{greet}\n\nJust floating this back to the top of your inbox. If succession or a partial "
                  f"partnership is ever on your mind, I'd value a short, confidential chat about {company}.\n\nBest,\n[Your Name]")
        opener = (f"Hi, this is [Your Name]. I work with owners of established {f.get('industry') or 'local'} businesses "
                  f"on succession planning. I noticed {company} has {hook} - do you have two minutes?")
        linkedin = f"Hi{' ' + name if name else ''} - I admire what you've built at {company}. I work with owners on succession and growth; would love to connect."
    elif goal == "partnership":
        subject = f"Partnership idea for {company}"
        body = (f"{greet}\n\nI've been following {company} and {hook} stood out. I'm {sender}. We serve a similar "
                f"customer base and I think there's a clean referral opportunity that would benefit both of us.\n\n"
                f"Open to a quick call next week to compare notes?\n\nBest,\n[Your Name]")
        follow = f"{greet}\n\nFollowing up on the partnership idea - happy to share how a referral arrangement could work for {company}.\n\nBest,\n[Your Name]"
        opener = f"Hi, it's [Your Name]. I'm reaching out because our customers overlap with {company}'s and I had a partnership idea - is now a bad time?"
        linkedin = f"Hi{' ' + name if name else ''} - we serve a similar market to {company}. Would love to connect and explore referrals."
    else:
        subject = f"Quick idea for {company}"
        pain = "keeping up with hiring and operations" if f.get("hiring") else "winning more of the right customers"
        body = (f"{greet}\n\nI noticed {company} and {hook}. Teams like yours often tell us their biggest challenge is "
                f"{pain}. I'm {sender} - we help {f.get('industry') or 'businesses'} like yours tackle exactly that.\n\n"
                f"Worth a 15-minute call to see if it's a fit?\n\nBest,\n[Your Name]")
        follow = f"{greet}\n\nCircling back in case my last note got buried - happy to share a 2-minute overview tailored to {company}.\n\nBest,\n[Your Name]"
        opener = f"Hi, this is [Your Name]. I work with {f.get('industry') or 'companies'} like {company} on {pain} - do you have 30 seconds for me to explain why I called?"
        linkedin = f"Hi{' ' + name if name else ''} - I work with {f.get('industry') or 'companies'} like {company}. Would be great to connect."

    return OutreachResult(subject[:120], body, linkedin[:300], opener, follow, points, "template")
