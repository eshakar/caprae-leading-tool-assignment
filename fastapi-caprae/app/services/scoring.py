"""Deal Signal Score: an explainable 0-100 score per lead.

Every point awarded carries a human-readable reason so a searcher / SDR can trust the ranking and
explain it to their team. Weights come from the user's ICP profile and always sum to 100.
"""

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

from app.models.icp import DEFAULT_WEIGHTS

HOT_THRESHOLD = 75
WARM_THRESHOLD = 55
# Knockout caps: a lead that fails a hard requirement can't rank as hot no matter how good the rest looks.
INDUSTRY_MISS_CAP = 55
LOCATION_MISS_CAP = 70
PE_BACKED_CAP = 40


class LeadLike(Protocol):
    industry: str | None
    state: str | None
    employee_count: int | None
    revenue_usd: int | None
    founded_year: int | None
    owner_name: str | None
    phone: str | None
    linkedin_url: str | None
    emails: list[dict[str, Any]]
    phones: list[str]
    socials: dict[str, str]
    tech_stack: list[str]
    signals: dict[str, Any]


class ICPLike(Protocol):
    mode: str
    target_industries: list[str]
    target_states: list[str]
    min_employees: int | None
    max_employees: int | None
    min_revenue: int | None
    max_revenue: int | None
    min_years_in_business: int | None
    weights: dict[str, Any]


@dataclass
class Factor:
    key: str
    label: str
    points: float
    max: float
    reason: str

    @property
    def sentiment(self) -> str:
        if self.points < 0:
            return "negative"
        if self.max == 0:
            return "neutral"
        ratio = self.points / self.max
        return "positive" if ratio >= 0.7 else "negative" if ratio < 0.35 else "neutral"

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["points"] = round(self.points, 1)
        d["sentiment"] = self.sentiment
        return d


def normalized_weights(raw: dict[str, Any] | None) -> dict[str, float]:
    weights = {k: float(max(0, (raw or {}).get(k, v) or 0)) for k, v in DEFAULT_WEIGHTS.items()}
    total = sum(weights.values())
    if total <= 0:
        weights = {k: float(v) for k, v in DEFAULT_WEIGHTS.items()}
        total = sum(weights.values())
    return {k: v * 100.0 / total for k, v in weights.items()}


def _fmt_money(n: int) -> str:
    if n >= 1_000_000_000:
        return f"${n / 1_000_000_000:.1f}B"
    if n >= 1_000_000:
        return f"${n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"${n / 1_000:.0f}K"
    return f"${n}"


def _range_fit(value: int | None, lo: int | None, hi: int | None, w: float, noun: str, fmt=str) -> tuple[float, str]:
    if lo is None and hi is None:
        return w * 0.5, f"No {noun} range set in your profile"
    if value is None:
        return w * 0.3, f"{noun.capitalize()} unknown - enrich or import to improve accuracy"
    lo_v = lo if lo is not None else 0
    hi_v = hi if hi is not None else float("inf")
    shown = fmt(value)
    if lo_v <= value <= hi_v:
        return w, f"{shown} is inside your target range"
    # Partial credit when within 50% of the boundary - near-misses are still worth a look.
    if value < lo_v and value >= lo_v * 0.5:
        return w * 0.5, f"{shown} is slightly below your minimum ({fmt(lo_v)})"
    if hi_v != float("inf") and value > hi_v and value <= hi_v * 1.5:
        return w * 0.5, f"{shown} is slightly above your maximum ({fmt(int(hi_v))})"
    return 0.0, f"{shown} is outside your target range"


def years_in_business(founded_year: int | None) -> int | None:
    if not founded_year:
        return None
    return max(0, datetime.now(timezone.utc).year - founded_year)


def score_lead(lead: LeadLike, icp: ICPLike) -> tuple[int, str, list[dict[str, Any]]]:
    w = normalized_weights(icp.weights)
    acquisition = (icp.mode or "acquisition") == "acquisition"
    sig = lead.signals or {}
    factors: list[Factor] = []

    # 1. Industry fit
    targets = [t.strip().lower() for t in (icp.target_industries or []) if t.strip()]
    ind = (lead.industry or "").lower()
    if not targets:
        factors.append(Factor("industry_fit", "Industry fit", w["industry_fit"] * 0.5, w["industry_fit"],
                              "No target industries set - add some in Settings to sharpen ranking"))
    elif ind and any(t in ind or ind in t for t in targets):
        factors.append(Factor("industry_fit", "Industry fit", w["industry_fit"], w["industry_fit"],
                              f"'{lead.industry}' matches your target industries"))
    elif not ind:
        factors.append(Factor("industry_fit", "Industry fit", w["industry_fit"] * 0.25, w["industry_fit"],
                              "Industry unknown"))
    else:
        factors.append(Factor("industry_fit", "Industry fit", 0, w["industry_fit"],
                              f"'{lead.industry}' is not in your target industries"))

    # 2-3. Size & revenue fit
    pts, why = _range_fit(lead.employee_count, icp.min_employees, icp.max_employees, w["size_fit"], "headcount",
                          lambda n: f"{n:,} employees")
    factors.append(Factor("size_fit", "Company size", pts, w["size_fit"], why))
    pts, why = _range_fit(lead.revenue_usd, icp.min_revenue, icp.max_revenue, w["revenue_fit"], "revenue", _fmt_money)
    factors.append(Factor("revenue_fit", "Revenue", pts, w["revenue_fit"], why))

    # 4. Location
    states = [s.strip().upper() for s in (icp.target_states or []) if s.strip()]
    st = (lead.state or "").upper()
    if not states:
        factors.append(Factor("location_fit", "Location", w["location_fit"] * 0.5, w["location_fit"],
                              "No target states set"))
    elif st in states:
        factors.append(Factor("location_fit", "Location", w["location_fit"], w["location_fit"],
                              f"Located in target state {st}"))
    else:
        factors.append(Factor("location_fit", "Location", 0, w["location_fit"],
                              f"{st or 'Unknown state'} is outside your target geography"))

    # 5. Longevity - durable cash flows (acquisition) / established buyer (sales)
    yib = years_in_business(lead.founded_year)
    min_years = icp.min_years_in_business or 0
    if yib is None:
        factors.append(Factor("longevity", "Years in business", w["longevity"] * 0.2, w["longevity"],
                              "Founding year unknown"))
    else:
        ratio = 1.0 if yib >= 25 else 0.75 if yib >= 15 else 0.5 if yib >= 10 else 0.25 if yib >= 5 else 0.05
        if min_years and yib < min_years:
            ratio = min(ratio, 0.2)
        reason = f"{yib} years in business (since {lead.founded_year})"
        if acquisition and yib >= 15:
            reason += " - proven, durable cash flows"
        factors.append(Factor("longevity", "Years in business", w["longevity"] * ratio, w["longevity"], reason))

    # 6. Succession / buying trigger
    reasons: list[str] = []
    ratio = 0.0
    if acquisition:
        if sig.get("succession_language"):
            ratio += 0.4; reasons.append("site mentions retirement/succession")
        if sig.get("family_owned"):
            ratio += 0.2; reasons.append("family-owned")
        if sig.get("generation"):
            ratio += 0.1; reasons.append(f"{sig['generation']}-generation business")
        if yib is not None and yib >= 30:
            ratio += 0.2; reasons.append(f"founder likely near retirement age ({yib}+ yrs)")
        if sig.get("stale_website"):
            ratio += 0.1; reasons.append(f"website not updated since {sig.get('copyright_year')}")
        label = "Succession signals"
        empty = "No succession signals detected yet"
    else:
        if sig.get("hiring"):
            ratio += 0.4; reasons.append("actively hiring (budget + growth)")
        if sig.get("stale_website"):
            ratio += 0.3; reasons.append(f"outdated website (©{sig.get('copyright_year')}) - modernization need")
        if lead.tech_stack and not any(t in lead.tech_stack for t in ("HubSpot", "Salesforce", "Marketo")):
            ratio += 0.3; reasons.append("no CRM / marketing automation detected")
        label = "Buying triggers"
        empty = "No buying triggers detected yet"
    ratio = min(ratio, 1.0)
    factors.append(Factor("succession", label, w["succession"] * ratio, w["succession"],
                          ("; ".join(reasons).capitalize()) if reasons else empty))

    # 7. Independence
    if sig.get("pe_backed"):
        factors.append(Factor("independence", "Ownership", 0, w["independence"],
                              "Appears PE-backed or part of a larger group" if acquisition
                              else "Part of a larger group - longer buying cycle"))
    elif sig.get("owner_operated") or sig.get("family_owned") or lead.owner_name:
        factors.append(Factor("independence", "Ownership", w["independence"], w["independence"],
                              "Independent, owner-operated - you can reach the decision maker"))
    else:
        factors.append(Factor("independence", "Ownership", w["independence"] * 0.5, w["independence"],
                              "Ownership not confirmed"))

    # 8. Contactability - a great lead you can't reach is not a great lead
    emails = lead.emails or []
    personal_valid = [e for e in emails if e.get("status") == "valid" and not e.get("is_role")]
    any_ok = [e for e in emails if e.get("status") in ("valid", "risky")]
    has_phone = bool(lead.phone or lead.phones)
    has_linkedin = bool(lead.linkedin_url or (lead.socials or {}).get("linkedin"))
    c = 0.0
    bits = []
    if personal_valid:
        c += 0.5; bits.append(f"{len(personal_valid)} verified personal email(s)")
    elif any_ok:
        c += 0.3; bits.append("generic/role email only")
    if has_phone:
        c += 0.25; bits.append("phone")
    if has_linkedin:
        c += 0.1; bits.append("LinkedIn")
    if lead.owner_name:
        c += 0.15; bits.append(f"owner identified ({lead.owner_name})")
    c = min(c, 1.0)
    factors.append(Factor("contactability", "Contactability", w["contactability"] * c, w["contactability"],
                          ("Has " + ", ".join(bits)) if bits else "No verified contact channel - run enrichment"))

    # 9. Growth / health
    g = 0.0
    gbits = []
    if sig.get("hiring"):
        g += 0.6; gbits.append("hiring")
    if sig.get("has_online_booking"):
        g += 0.2; gbits.append("online booking")
    if (lead.socials or {}) and len(lead.socials) >= 2:
        g += 0.2; gbits.append("active social presence")
    g = min(g, 1.0)
    factors.append(Factor("growth", "Growth & health", w["growth"] * g, w["growth"],
                          ("Signals: " + ", ".join(gbits)) if gbits else "No growth signals detected"))

    raw = sum(f.points for f in factors)
    caps: list[tuple[int, str]] = []
    if targets and ind and factors[0].points == 0:
        caps.append((INDUSTRY_MISS_CAP, f"Outside target industries - capped at {INDUSTRY_MISS_CAP}"))
    if states and st and st not in states:
        caps.append((LOCATION_MISS_CAP, f"Outside target geography - capped at {LOCATION_MISS_CAP}"))
    if acquisition and sig.get("pe_backed"):
        caps.append((PE_BACKED_CAP, f"Already institutionally owned - capped at {PE_BACKED_CAP}"))
    if caps:
        cap, why = min(caps, key=lambda c: c[0])
        factors.append(Factor("knockout", "Fit gate", min(0.0, cap - raw), 0, why))
        raw = min(raw, cap)
    total = max(0, min(100, int(round(raw))))
    tier = "hot" if total >= HOT_THRESHOLD else "warm" if total >= WARM_THRESHOLD else "cold"
    return total, tier, [f.to_dict() for f in factors]


def next_best_action(lead: Any) -> str:
    """One concrete instruction so the user always knows what to do with a lead."""
    # A due follow-up is the most time-sensitive thing about a lead, so it wins over everything else.
    stage = lead.stage
    follow_up = getattr(lead, "follow_up_at", None)
    if follow_up and stage in ("contacted", "replied"):
        due = follow_up if follow_up.tzinfo else follow_up.replace(tzinfo=timezone.utc)
        if due <= datetime.now(timezone.utc):
            if stage == "contacted":
                return "Follow-up is due today - send your follow-up draft or call"
            return "They replied - book the intro call now"
    if lead.enrichment_status in ("pending", "failed") and lead.domain:
        return "Enrich this lead to uncover contacts and deal signals"
    emails = lead.emails or []
    if not any(e.get("status") in ("valid", "risky") for e in emails) and not (lead.phone or lead.phones):
        return "Find a contact channel - no verified email or phone yet"
    if stage == "new":
        return "Generate a personalized intro with the AI Copilot and reach out" if lead.score_tier != "cold" \
            else "Low fit - deprioritize or adjust your ICP"
    if stage == "contacted":
        return "Send the follow-up in 3 business days if no reply"
    if stage == "replied":
        return "Book an intro call while interest is warm"
    if stage == "meeting":
        return "Prepare a tailored proposal / LOI discussion"
    return "No action needed"
