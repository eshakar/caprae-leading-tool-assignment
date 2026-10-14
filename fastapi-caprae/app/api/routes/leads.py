import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import Select, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import EnrichmentJob, Lead, LeadActivity
from app.schemas.lead import (
    ActivityOut,
    BulkIds,
    BulkStage,
    DedupeResult,
    EnrichRequest,
    ImportResult,
    JobOut,
    LeadCreate,
    LeadListItem,
    LeadOut,
    LeadPage,
    LeadUpdate,
)
from app.services import leads as svc
from app.services.activity import action_center, add_activity, change_stage, is_follow_up_due, record_score_change, set_follow_up
from app.services.email_validation import verify_many
from app.services.normalize import normalize_domain, normalize_phone, normalize_state, website_from_domain
from app.services.scoring import next_best_action

router = APIRouter(prefix="/leads", tags=["leads"])

SortKey = Literal["-score", "score", "company_name", "-company_name", "-created_at", "created_at",
                  "-revenue_usd", "revenue_usd", "-employee_count", "employee_count", "-founded_year", "founded_year"]
MAX_UPLOAD_BYTES = 5 * 1024 * 1024


def to_out(lead: Lead) -> LeadOut:
    out = LeadOut.model_validate(lead)
    out.next_action = next_best_action(lead)
    out.follow_up_due = is_follow_up_due(lead)
    return out


def to_list_item(lead: Lead) -> LeadListItem:
    item = LeadListItem.model_validate(lead)
    item.follow_up_due = is_follow_up_due(lead)
    best = next((e for e in lead.emails or [] if e.get("status") == "valid"), None) or \
        next((e for e in lead.emails or [] if e.get("status") == "risky"), None)
    if best:
        item.best_email, item.email_status = best["email"], best["status"]
    item.top_reason = top_reason(lead.score_breakdown or [])
    return item


# Signals that differentiate leads which all fit the ICP, most telling first.
SIGNAL_PRIORITY = ("succession", "growth", "longevity", "contactability", "independence")


def top_reason(breakdown: list[dict]) -> str | None:
    """The most telling reason for the table row: a knockout first, then a strong differentiating signal."""
    knock = next((f for f in breakdown if f.get("key") == "knockout"), None)
    if knock:
        return knock["reason"]
    ratio = lambda f: f.get("points", 0) / (f.get("max") or 1)  # noqa: E731
    for key in SIGNAL_PRIORITY:
        f = next((f for f in breakdown if f.get("key") == key), None)
        if f and ratio(f) >= 0.7:
            return f["reason"]
    best = max(breakdown, key=lambda f: (ratio(f), f.get("max", 0)), default=None)
    return best["reason"] if best else None


def get_lead_or_404(db: Session, lead_id: int) -> Lead:
    lead = db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


def apply_filters(
    q: Select, search: str | None, industry: list[str] | None, state: list[str] | None, tier: list[str] | None,
    stage: list[str] | None, min_score: int | None, max_score: int | None, has_email: bool | None,
    enrichment_status: str | None, follow_up_due: bool | None = None,
) -> Select:
    if search:
        like = f"%{search.strip()}%"
        q = q.where(or_(Lead.company_name.ilike(like), Lead.domain.ilike(like), Lead.owner_name.ilike(like),
                        Lead.city.ilike(like), Lead.industry.ilike(like)))
    if industry:
        q = q.where(Lead.industry.in_(industry))
    if state:
        q = q.where(Lead.state.in_([s.upper() for s in state]))
    if tier:
        q = q.where(Lead.score_tier.in_(tier))
    if stage:
        q = q.where(Lead.stage.in_(stage))
    if min_score is not None:
        q = q.where(Lead.score >= min_score)
    if max_score is not None:
        q = q.where(Lead.score <= max_score)
    if has_email is True:
        q = q.where(func.jsonb_array_length(Lead.emails) > 0)
    elif has_email is False:
        q = q.where(func.jsonb_array_length(Lead.emails) == 0)
    if enrichment_status:
        q = q.where(Lead.enrichment_status == enrichment_status)
    if follow_up_due:
        q = q.where(Lead.stage.in_(["contacted", "replied"]), Lead.follow_up_at.is_not(None),
                    Lead.follow_up_at <= func.now())
    return q


@router.get("", response_model=LeadPage)
def list_leads(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None, max_length=200),
    industry: list[str] | None = Query(default=None),
    state: list[str] | None = Query(default=None),
    tier: list[str] | None = Query(default=None),
    stage: list[str] | None = Query(default=None),
    min_score: int | None = Query(default=None, ge=0, le=100),
    max_score: int | None = Query(default=None, ge=0, le=100),
    has_email: bool | None = None,
    enrichment_status: str | None = None,
    follow_up_due: bool | None = None,
    sort: SortKey = "-score",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
) -> LeadPage:
    base = apply_filters(select(Lead), search, industry, state, tier, stage, min_score, max_score, has_email,
                         enrichment_status, follow_up_due)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    col = getattr(Lead, sort.lstrip("-"))
    order = col.desc().nulls_last() if sort.startswith("-") else col.asc().nulls_last()
    rows = db.scalars(base.order_by(order, Lead.id).offset((page - 1) * page_size).limit(page_size)).all()
    return LeadPage(items=[to_list_item(r) for r in rows], total=total, page=page, page_size=page_size)


@router.get("/facets")
def facets(db: Session = Depends(get_db)) -> dict[str, list[str]]:
    """Distinct values for filter dropdowns."""
    industries = db.scalars(select(Lead.industry).where(Lead.industry.is_not(None)).distinct().order_by(Lead.industry)).all()
    states = db.scalars(select(Lead.state).where(Lead.state.is_not(None)).distinct().order_by(Lead.state)).all()
    return {"industries": list(industries), "states": list(states)}


@router.get("/export")
def export_leads(
    db: Session = Depends(get_db),
    format: Literal["standard", "hubspot", "salesforce"] = "standard",
    ids: list[int] | None = Query(default=None),
    search: str | None = None,
    industry: list[str] | None = Query(default=None),
    state: list[str] | None = Query(default=None),
    tier: list[str] | None = Query(default=None),
    stage: list[str] | None = Query(default=None),
    min_score: int | None = None,
    has_email: bool | None = None,
) -> Response:
    q = select(Lead)
    if ids:
        q = q.where(Lead.id.in_(ids))
    else:
        q = apply_filters(q, search, industry, state, tier, stage, min_score, None, has_email, None)
    leads = db.scalars(q.order_by(Lead.score.desc()).limit(10_000)).all()
    body = svc.export_csv(list(leads), format)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="saasquatch-leads-{format}-{stamp}.csv"'},
    )


@router.post("/import", response_model=ImportResult)
async def import_leads(file: UploadFile = File(...), db: Session = Depends(get_db)) -> ImportResult:
    if file.filename and not file.filename.lower().endswith((".csv", ".txt")):
        raise HTTPException(status_code=400, detail="Please upload a .csv file")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="CSV is larger than 5 MB")
    try:
        result = await svc.import_csv(db, content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ImportResult(**result)


@router.post("/dedupe", response_model=DedupeResult)
def dedupe(db: Session = Depends(get_db)) -> DedupeResult:
    return DedupeResult(**svc.merge_duplicates(db))


@router.get("/duplicates")
def duplicates(db: Session = Depends(get_db)) -> list[list[dict]]:
    return [[{"id": l.id, "company_name": l.company_name, "domain": l.domain} for l in g]
            for g in svc.find_duplicate_groups(db)]


@router.post("/rescore")
def rescore(db: Session = Depends(get_db)) -> dict[str, int]:
    return {"rescored": svc.rescore_all(db)}


@router.post("/enrich", response_model=JobOut, status_code=status.HTTP_202_ACCEPTED)
def enrich_bulk(payload: EnrichRequest, background: BackgroundTasks, db: Session = Depends(get_db)) -> EnrichmentJob:
    ids = list(dict.fromkeys(payload.ids))
    existing = db.scalars(select(Lead.id).where(Lead.id.in_(ids))).all()
    if not existing:
        raise HTTPException(status_code=404, detail="None of the selected leads exist")
    job = EnrichmentJob(id=str(uuid.uuid4()), status="queued", total=len(existing), lead_ids=list(existing),
                        errors=[], completed=0, failed=0)
    db.add(job)
    db.commit()
    db.refresh(job)
    background.add_task(svc.run_enrichment_job, job.id, payload.force)
    return job


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: str, db: Session = Depends(get_db)) -> EnrichmentJob:
    job = db.get(EnrichmentJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/bulk/stage")
def bulk_stage(payload: BulkStage, db: Session = Depends(get_db)) -> dict[str, int]:
    leads = db.scalars(select(Lead).where(Lead.id.in_(payload.ids))).all()
    updated = sum(1 for lead in leads if change_stage(lead, payload.stage))
    db.commit()
    return {"updated": updated}


@router.post("/bulk/delete")
def bulk_delete(payload: BulkIds, db: Session = Depends(get_db)) -> dict[str, int]:
    result = db.execute(delete(Lead).where(Lead.id.in_(payload.ids)))
    db.commit()
    return {"deleted": result.rowcount or 0}


@router.post("", response_model=LeadOut, status_code=status.HTTP_201_CREATED)
async def create_lead(payload: LeadCreate, response: Response, db: Session = Depends(get_db)) -> LeadOut:
    domain = normalize_domain(payload.domain) if payload.domain else None
    if payload.domain and not domain:
        raise HTTPException(status_code=422, detail="Website/domain is not valid")
    if not domain and not payload.company_name:
        raise HTTPException(status_code=422, detail="Provide a company name or a website")

    dup = svc.find_duplicate(db, domain, payload.company_name)
    if dup:
        response.status_code = status.HTTP_200_OK
        response.headers["X-Duplicate-Of"] = str(dup.id)
        return to_out(dup)

    data = payload.model_dump(exclude={"email", "auto_enrich", "domain", "company_name", "tags"}, exclude_none=True)
    data["state"] = normalize_state(data.get("state"))
    data["phone"] = normalize_phone(data.get("phone")) or data.get("phone")
    emails = [c.to_dict() for c in await verify_many([payload.email], source="manual")] if payload.email else []
    lead = Lead(
        **data,
        company_name=payload.company_name or domain or "Unknown company",
        domain=domain,
        website=website_from_domain(domain),
        emails=emails, phones=[], socials={}, tech_stack=[], signals={}, tags=payload.tags or [],
        source="manual", enrichment_status="pending" if domain else "skipped",
    )
    svc.apply_score(lead, svc.get_icp(db))
    add_activity(lead, "created", "Added manually" + (f" from {domain}" if domain else ""))
    db.add(lead)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A lead with this domain already exists") from exc
    db.refresh(lead)

    if payload.auto_enrich and domain:
        lead = await svc.enrich_lead(db, lead)
    return to_out(lead)


@router.get("/actions/today")
def actions_today(db: Session = Depends(get_db)) -> dict:
    """Action Center: overdue follow-ups, follow-ups due this week and hot leads nobody has contacted."""
    return action_center(db)


@router.get("/{lead_id}/activities", response_model=list[ActivityOut])
def lead_activities(lead_id: int, db: Session = Depends(get_db)) -> list[LeadActivity]:
    get_lead_or_404(db, lead_id)
    return list(db.scalars(
        select(LeadActivity).where(LeadActivity.lead_id == lead_id)
        .order_by(LeadActivity.created_at.desc(), LeadActivity.id.desc()).limit(100)
    ).all())


@router.get("/{lead_id}", response_model=LeadOut)
def get_lead(lead_id: int, db: Session = Depends(get_db)) -> LeadOut:
    return to_out(get_lead_or_404(db, lead_id))


@router.patch("/{lead_id}", response_model=LeadOut)
def update_lead(lead_id: int, payload: LeadUpdate, db: Session = Depends(get_db)) -> LeadOut:
    lead = get_lead_or_404(db, lead_id)
    changes = payload.model_dump(exclude_unset=True)
    if "domain" in changes:
        new_domain = normalize_domain(changes.pop("domain")) if payload.domain else None
        if payload.domain and not new_domain:
            raise HTTPException(status_code=422, detail="Website/domain is not valid")
        if new_domain != lead.domain:
            if new_domain and svc.find_duplicate(db, new_domain, None, exclude_id=lead.id):
                raise HTTPException(status_code=409, detail="Another lead already uses this domain")
            lead.domain, lead.website = new_domain, website_from_domain(new_domain)
            lead.enrichment_status = "pending" if new_domain else "skipped"
    if "state" in changes:
        changes["state"] = normalize_state(changes["state"])
    if "company_name" in changes and not changes["company_name"]:
        changes.pop("company_name")
    if "tags" in changes and changes["tags"] is None:
        changes["tags"] = []

    before = lead.score
    stage = changes.pop("stage", None)
    has_follow_up = "follow_up_at" in changes
    follow_up = changes.pop("follow_up_at", None)
    if stage:
        change_stage(lead, stage)
    if has_follow_up:  # an explicit date wins over the stage's default schedule
        set_follow_up(lead, follow_up)
    if "notes" in changes and (changes["notes"] or "") != (lead.notes or ""):
        snippet = (changes["notes"] or "").strip()
        add_activity(lead, "note", f"Note updated: {snippet[:140]}{'…' if len(snippet) > 140 else ''}" if snippet else "Note cleared")
    edited = [f for f, v in changes.items() if f not in ("notes", "tags") and getattr(lead, f) != v]
    for field, value in changes.items():
        setattr(lead, field, value)
    if edited:
        add_activity(lead, "edited", "Updated " + ", ".join(f.replace("_", " ") for f in edited), {"fields": edited})
    svc.apply_score(lead, svc.get_icp(db))
    if edited:
        record_score_change(lead, before, "details edited")
    db.commit()
    db.refresh(lead)
    return to_out(lead)


@router.delete("/{lead_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lead(lead_id: int, db: Session = Depends(get_db)) -> Response:
    db.delete(get_lead_or_404(db, lead_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{lead_id}/enrich", response_model=LeadOut)
async def enrich_one(lead_id: int, force: bool = True, db: Session = Depends(get_db)) -> LeadOut:
    lead = get_lead_or_404(db, lead_id)
    if not lead.domain:
        raise HTTPException(status_code=400, detail="Add a website to this lead before enriching")
    return to_out(await svc.enrich_lead(db, lead, force=force))
