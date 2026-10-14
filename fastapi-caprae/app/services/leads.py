"""Lead domain logic: ICP access, scoring, enrichment orchestration, dedup, CSV import/export."""

import asyncio
import csv
import io
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import EnrichmentJob, ICPProfile, Lead
from app.models.icp import DEFAULT_WEIGHTS
from app.services.activity import add_activity, record_score_change
from app.services.crawler import Crawler, EnrichmentResult
from app.services.email_validation import FREE_PROVIDERS, verify_many
from app.services.normalize import (
    clean_str,
    normalize_company_name,
    normalize_domain,
    normalize_phone,
    normalize_state,
    parse_int,
    website_from_domain,
)
from app.services.scoring import score_lead

log = logging.getLogger(__name__)


# ---------------------------------------------------------------- ICP + scoring
def get_icp(db: Session) -> ICPProfile:
    icp = db.get(ICPProfile, 1)
    if icp is None:
        icp = ICPProfile(
            id=1,
            name="Search fund - home services",
            mode="acquisition",
            target_industries=["HVAC", "Plumbing", "Electrical", "Pest Control"],
            target_states=["TX", "FL", "GA", "NC", "TN"],
            min_employees=15,
            max_employees=100,
            min_revenue=3_000_000,
            max_revenue=20_000_000,
            min_years_in_business=15,
            weights=dict(DEFAULT_WEIGHTS),
        )
        db.add(icp)
        db.commit()
        db.refresh(icp)
    return icp


def apply_score(lead: Lead, icp: ICPProfile) -> None:
    lead.score, lead.score_tier, lead.score_breakdown = score_lead(lead, icp)


def rescore_all(db: Session) -> int:
    icp = get_icp(db)
    leads = db.scalars(select(Lead)).all()
    for lead in leads:
        apply_score(lead, icp)
    db.commit()
    return len(leads)


# ---------------------------------------------------------------- dedup
def find_duplicate(db: Session, domain: str | None, company_name: str | None, exclude_id: int | None = None) -> Lead | None:
    if domain:
        q = select(Lead).where(Lead.domain == domain)
        if exclude_id:
            q = q.where(Lead.id != exclude_id)
        hit = db.scalars(q).first()
        if hit:
            return hit
    key = normalize_company_name(company_name)
    if len(key) >= 4:
        # Narrow by a cheap DB prefix filter, then compare canonical keys in Python.
        prefix = (company_name or "").strip()[:3]
        q = select(Lead).where(Lead.company_name.ilike(f"{prefix}%"))
        if exclude_id:
            q = q.where(Lead.id != exclude_id)
        for cand in db.scalars(q).all():
            if normalize_company_name(cand.company_name) == key:
                return cand
    return None


def merge_into(target: Lead, data: dict[str, Any]) -> list[str]:
    """Fill empty fields on an existing lead from new data. Never overwrites user-entered values."""
    filled = []
    for field, value in data.items():
        if value in (None, "", [], {}):
            continue
        if getattr(target, field, None) in (None, "", [], {}):
            setattr(target, field, value)
            filled.append(field)
    return filled


def find_duplicate_groups(db: Session) -> list[list[Lead]]:
    groups: dict[str, list[Lead]] = {}
    for lead in db.scalars(select(Lead).order_by(Lead.created_at)).all():
        key = normalize_company_name(lead.company_name)
        if key:
            groups.setdefault(key, []).append(lead)
    return [g for g in groups.values() if len(g) > 1]


def merge_duplicates(db: Session) -> dict[str, int]:
    """Merge leads sharing a canonical company name; keep the oldest record (it has the history)."""
    merged = removed = 0
    for group in find_duplicate_groups(db):
        keeper, *dupes = group
        for d in dupes:
            data = {c: getattr(d, c) for c in (
                "domain", "website", "industry", "description", "city", "state", "employee_count", "revenue_usd",
                "founded_year", "owner_name", "owner_title", "phone", "linkedin_url")}
            if data["domain"] and keeper.domain is None:
                d.domain = None  # free the unique domain before assigning it to the keeper
                db.flush()
            merge_into(keeper, data)
            # Union contact data
            seen = {e["email"] for e in keeper.emails or []}
            keeper.emails = (keeper.emails or []) + [e for e in (d.emails or []) if e["email"] not in seen]
            keeper.phones = list(dict.fromkeys((keeper.phones or []) + (d.phones or [])))
            keeper.tags = list(dict.fromkeys((keeper.tags or []) + (d.tags or [])))
            keeper.socials = {**(d.socials or {}), **(keeper.socials or {})}
            add_activity(keeper, "edited", f"Merged duplicate record '{d.company_name}'")
            db.delete(d)
            removed += 1
        merged += 1
    if merged:
        db.flush()
        icp = get_icp(db)
        for lead in db.scalars(select(Lead)).all():
            apply_score(lead, icp)
    db.commit()
    return {"groups_merged": merged, "records_removed": removed}


# ---------------------------------------------------------------- enrichment
def is_cache_fresh(lead: Lead) -> bool:
    if lead.enrichment_status != "enriched" or not lead.enriched_at:
        return False
    ttl = timedelta(days=get_settings().enrichment_cache_days)
    enriched_at = lead.enriched_at if lead.enriched_at.tzinfo else lead.enriched_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - enriched_at < ttl


async def apply_enrichment(lead: Lead, result: EnrichmentResult) -> None:
    now = datetime.now(timezone.utc)
    if not result.ok and result.signals.get("reserved_domain"):
        lead.enrichment_error = result.error  # demo record: keep its seeded data and status
        return
    if not result.ok:
        lead.enrichment_status = "failed"
        lead.enrichment_error = result.error
        lead.enriched_at = now
        lead.signals = {**(lead.signals or {}), **result.signals}
        add_activity(lead, "enrichment_failed", f"Enrichment failed: {result.error}")
        return

    checks = await verify_many(result.emails, source="website")
    existing = {e["email"]: e for e in (lead.emails or []) if e.get("source") != "website"}
    lead.emails = [c.to_dict() for c in checks] + [e for k, e in existing.items() if k not in {c.email for c in checks}]
    lead.phones = result.phones
    lead.socials = {**(lead.socials or {}), **result.socials}
    lead.tech_stack = result.tech_stack
    lead.signals = {**(lead.signals or {}), **result.signals, "pages": result.pages_crawled}
    merge_into(lead, {
        "description": result.description,
        "city": result.city,
        "state": result.state,
        "founded_year": result.founded_year,
        "employee_count": result.employee_count,
        "owner_name": result.owner_name,
        "phone": result.phones[0] if result.phones else None,
        "linkedin_url": result.socials.get("linkedin"),
    })
    if result.company_name and (not lead.company_name or lead.company_name == lead.domain):
        lead.company_name = result.company_name
    if result.final_url:
        lead.website = result.final_url.rstrip("/")
    lead.enrichment_status = "enriched"
    lead.enrichment_error = None
    lead.enriched_at = now
    valid = sum(1 for c in checks if c.status == "valid")
    found = [f"{len(checks)} emails ({valid} verified)", f"{len(result.phones)} phones",
             f"{len(result.tech_stack)} technologies"]
    flags = [k.replace("_", " ") for k in ("family_owned", "succession_language", "hiring", "pe_backed")
             if result.signals.get(k)]
    add_activity(lead, "enriched", "Website enriched: " + ", ".join(found) + (f"; signals: {', '.join(flags)}" if flags else ""),
                 {"pages": len(result.pages_crawled)})


async def enrich_lead(db: Session, lead: Lead, force: bool = False, crawler: Crawler | None = None) -> Lead:
    if not lead.domain:
        lead.enrichment_status = "skipped"
        lead.enrichment_error = "No website/domain on record"
        db.commit()
        return lead
    if not force and is_cache_fresh(lead):
        return lead  # served from DB cache - avoids re-crawling the same site
    if crawler is None:
        async with Crawler() as c:
            result = await c.enrich(lead.domain)
    else:
        result = await crawler.enrich(lead.domain)
    before = lead.score
    await apply_enrichment(lead, result)
    apply_score(lead, get_icp(db))
    record_score_change(lead, before, "new data from enrichment")
    db.commit()
    db.refresh(lead)
    return lead


async def run_enrichment_job(job_id: str, force: bool = False) -> None:
    """Background task: enrich many leads concurrently with a bounded semaphore."""
    settings = get_settings()
    db = SessionLocal()
    try:
        job = db.get(EnrichmentJob, job_id)
        if job is None:
            return
        job.status = "running"
        db.commit()
        sem = asyncio.Semaphore(settings.crawler_concurrency)
        lead_ids = list(job.lead_ids)

        async with Crawler() as crawler:
            async def crawl(lead_id: int) -> tuple[int, EnrichmentResult | None, str | None]:
                lead = db.get(Lead, lead_id)
                if lead is None or not lead.domain:
                    return lead_id, None, "No domain"
                if not force and is_cache_fresh(lead):
                    return lead_id, None, None
                async with sem:
                    return lead_id, await crawler.enrich(lead.domain), None

            icp = get_icp(db)
            for coro in asyncio.as_completed([crawl(i) for i in lead_ids]):
                lead_id, result, err = await coro
                lead = db.get(Lead, lead_id)
                try:
                    if result is not None and lead is not None:
                        before = lead.score
                        await apply_enrichment(lead, result)
                        apply_score(lead, icp)
                        record_score_change(lead, before, "new data from enrichment")
                        if not result.ok:
                            job.failed += 1
                            job.errors = [*job.errors, {"lead_id": lead_id, "error": result.error}]
                    elif err and lead is not None:
                        lead.enrichment_status = "skipped"
                        lead.enrichment_error = err
                        job.failed += 1
                        job.errors = [*job.errors, {"lead_id": lead_id, "error": err}]
                except Exception as exc:  # noqa: BLE001 - one bad site must not kill the batch
                    log.exception("Enrichment failed for lead %s", lead_id)
                    job.failed += 1
                    job.errors = [*job.errors, {"lead_id": lead_id, "error": str(exc)[:200]}]
                job.completed += 1
                db.commit()
        job.status = "done"
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:  # noqa: BLE001
        log.exception("Enrichment job %s crashed", job_id)
        db.rollback()
        job = db.get(EnrichmentJob, job_id)
        if job:
            job.status = "failed"
            job.finished_at = datetime.now(timezone.utc)
            db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------- CSV import / export
CSV_ALIASES: dict[str, tuple[str, ...]] = {
    "company_name": ("company_name", "company", "name", "business_name", "business", "organization", "account_name"),
    "domain": ("domain", "website", "url", "site", "web", "company_website", "homepage"),
    "industry": ("industry", "category", "vertical", "sector"),
    "city": ("city", "town"),
    "state": ("state", "region", "province", "state_code"),
    "country": ("country",),
    "employee_count": ("employee_count", "employees", "headcount", "company_size", "size", "num_employees"),
    "revenue_usd": ("revenue_usd", "revenue", "annual_revenue", "sales"),
    "founded_year": ("founded_year", "founded", "year_founded", "established"),
    "owner_name": ("owner_name", "owner", "contact_name", "contact", "ceo", "founder", "full_name"),
    "owner_title": ("owner_title", "title", "job_title", "position"),
    "phone": ("phone", "phone_number", "telephone", "tel"),
    "email": ("email", "email_address", "contact_email", "work_email"),
    "linkedin_url": ("linkedin_url", "linkedin", "linkedin_profile"),
    "description": ("description", "about", "summary"),
}


def _map_headers(headers: list[str]) -> dict[str, str]:
    norm = {h: h.strip().lower().replace(" ", "_").replace("-", "_") for h in headers}
    mapping: dict[str, str] = {}
    for field, aliases in CSV_ALIASES.items():
        for original, n in norm.items():
            if n in aliases and original not in mapping.values():
                mapping[field] = original
                break
    return mapping


def row_to_lead_data(row: dict[str, str], mapping: dict[str, str]) -> dict[str, Any]:
    get = lambda f: row.get(mapping[f]) if f in mapping else None  # noqa: E731
    domain = normalize_domain(get("domain")) or (normalize_domain(get("email")) if get("email") else None)
    if domain in FREE_PROVIDERS:  # a personal webmail address says nothing about the company's site
        domain = None
    founded = parse_int(get("founded_year"))
    return {
        "company_name": clean_str(get("company_name"), 255) or domain,
        "domain": domain,
        "website": website_from_domain(domain),
        "industry": clean_str(get("industry"), 120),
        "city": clean_str(get("city"), 120),
        "state": normalize_state(clean_str(get("state"))),
        "country": clean_str(get("country"), 64) or "US",
        "employee_count": parse_int(get("employee_count")),
        "revenue_usd": parse_int(get("revenue_usd")),
        "founded_year": founded if founded and 1800 <= founded <= datetime.now().year else None,
        "owner_name": clean_str(get("owner_name"), 255),
        "owner_title": clean_str(get("owner_title"), 120),
        "phone": normalize_phone(clean_str(get("phone"))),
        "linkedin_url": clean_str(get("linkedin_url"), 512),
        "description": clean_str(get("description")),
        "_email": clean_str(get("email")),
    }


async def import_csv(db: Session, content: bytes) -> dict[str, Any]:
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("CSV has no header row")
    mapping = _map_headers(list(reader.fieldnames))
    if "company_name" not in mapping and "domain" not in mapping:
        raise ValueError("CSV needs at least a company name or website/domain column")

    icp = get_icp(db)
    created = merged = skipped = 0
    errors: list[str] = []
    seen_in_file: set[str] = set()
    for i, row in enumerate(reader, start=2):
        if i > 5002:
            errors.append("Stopped at 5,000 rows - split large files into batches")
            break
        data = row_to_lead_data(row, mapping)
        email = data.pop("_email")
        if not data["company_name"]:
            skipped += 1
            errors.append(f"Row {i}: missing company name and domain")
            continue
        key = data["domain"] or normalize_company_name(data["company_name"])
        if key in seen_in_file:
            skipped += 1
            continue
        seen_in_file.add(key)

        email_entries = []
        if email:
            checks = await verify_many([email], source="import")
            email_entries = [c.to_dict() for c in checks]

        dup = find_duplicate(db, data["domain"], data["company_name"])
        if dup:
            merge_into(dup, data)
            known = {e["email"] for e in dup.emails or []}
            dup.emails = (dup.emails or []) + [e for e in email_entries if e["email"] not in known]
            apply_score(dup, icp)
            add_activity(dup, "edited", "Filled missing fields from a CSV import")
            merged += 1
        else:
            lead = Lead(**data, emails=email_entries, phones=[], socials={}, tech_stack=[], signals={}, tags=[],
                        source="csv", enrichment_status="pending" if data["domain"] else "skipped")
            apply_score(lead, icp)
            add_activity(lead, "created", "Imported from CSV")
            db.add(lead)
            created += 1
        if (created + merged) % 200 == 0:
            db.flush()
    db.commit()
    return {"created": created, "merged": merged, "skipped": skipped, "errors": errors[:20],
            "columns_mapped": mapping}


EXPORT_FORMATS = ("standard", "hubspot", "salesforce")


def export_csv(leads: list[Lead], fmt: str = "standard") -> str:
    out = io.StringIO()
    writer = csv.writer(out)

    def best_email(lead: Lead) -> str:
        for status in ("valid", "risky"):
            for e in lead.emails or []:
                if e.get("status") == status:
                    return e["email"]
        return ""

    def split_name(n: str | None) -> tuple[str, str]:
        parts = (n or "").split(" ", 1)
        return parts[0], parts[1] if len(parts) > 1 else ""

    if fmt == "hubspot":
        writer.writerow(["Company name", "Company Domain Name", "Industry", "City", "State/Region",
                         "Number of Employees", "Annual Revenue", "Year Founded", "First Name", "Last Name",
                         "Email", "Phone Number", "LinkedIn Company Page", "Lead Status", "Deal Signal Score"])
        for l in leads:
            first, last = split_name(l.owner_name)
            writer.writerow([l.company_name, l.domain or "", l.industry or "", l.city or "", l.state or "",
                             l.employee_count or "", l.revenue_usd or "", l.founded_year or "", first, last,
                             best_email(l), l.phone or "", l.linkedin_url or "", l.stage.upper(), l.score])
    elif fmt == "salesforce":
        writer.writerow(["Company", "Website", "Industry", "City", "State", "NumberOfEmployees", "AnnualRevenue",
                         "FirstName", "LastName", "Title", "Email", "Phone", "LeadSource", "Rating", "Description"])
        for l in leads:
            first, last = split_name(l.owner_name)
            rating = {"hot": "Hot", "warm": "Warm", "cold": "Cold"}[l.score_tier]
            writer.writerow([l.company_name, l.website or "", l.industry or "", l.city or "", l.state or "",
                             l.employee_count or "", l.revenue_usd or "", first, last or "Unknown",
                             l.owner_title or "", best_email(l), l.phone or "", "SaaSquatch Pro", rating,
                             (l.description or "")[:250]])
    else:
        writer.writerow(["company_name", "domain", "website", "industry", "city", "state", "employee_count",
                         "revenue_usd", "founded_year", "owner_name", "owner_title", "best_email", "all_emails",
                         "phone", "linkedin", "tech_stack", "score", "tier", "stage", "top_reasons"])
        for l in leads:
            top = sorted(l.score_breakdown or [], key=lambda f: -f.get("points", 0))[:3]
            writer.writerow([l.company_name, l.domain or "", l.website or "", l.industry or "", l.city or "",
                             l.state or "", l.employee_count or "", l.revenue_usd or "", l.founded_year or "",
                             l.owner_name or "", l.owner_title or "", best_email(l),
                             "; ".join(f"{e['email']} ({e['status']})" for e in l.emails or []),
                             l.phone or "", l.linkedin_url or "", "; ".join(l.tech_stack or []), l.score,
                             l.score_tier, l.stage, " | ".join(f["reason"] for f in top)])
    return out.getvalue()


def stats(db: Session) -> dict[str, Any]:
    total = db.scalar(select(func.count(Lead.id))) or 0
    by_tier = dict(db.execute(select(Lead.score_tier, func.count()).group_by(Lead.score_tier)).all())
    by_stage = dict(db.execute(select(Lead.stage, func.count()).group_by(Lead.stage)).all())
    by_industry = db.execute(
        select(Lead.industry, func.count(), func.avg(Lead.score))
        .where(Lead.industry.is_not(None)).group_by(Lead.industry).order_by(func.count().desc()).limit(8)
    ).all()
    enriched = db.scalar(select(func.count(Lead.id)).where(Lead.enrichment_status == "enriched")) or 0
    avg_score = db.scalar(select(func.avg(Lead.score))) or 0
    buckets = db.execute(
        select(func.least(Lead.score / 10, 9).label("b"), func.count()).group_by("b").order_by("b")
    ).all()
    distribution = {int(b) * 10: c for b, c in buckets}
    with_email = db.scalar(
        select(func.count(Lead.id)).where(func.jsonb_array_length(Lead.emails) > 0)
    ) or 0
    return {
        "total": total,
        "enriched": enriched,
        "with_email": with_email,
        "avg_score": round(float(avg_score), 1),
        "by_tier": {t: by_tier.get(t, 0) for t in ("hot", "warm", "cold")},
        "by_stage": {s: by_stage.get(s, 0) for s in ("new", "contacted", "replied", "meeting", "won", "lost")},
        "by_industry": [{"industry": i, "count": c, "avg_score": round(float(a or 0), 1)} for i, c, a in by_industry],
        "score_distribution": [{"bucket": f"{b}-{min(b + 9, 100)}", "count": distribution.get(b, 0)}
                               for b in range(0, 100, 10)],
    }
