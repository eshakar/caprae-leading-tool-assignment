"""Seed a fictional sample dataset so the dashboard is meaningful on first launch.

All companies are invented and use the reserved `.example` TLD (RFC 2606) - no real business data.
Add real domains through the UI or CSV import to see live enrichment.
"""

import logging
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Lead
from app.services.activity import add_activity
from app.services.leads import apply_score, get_icp

log = logging.getLogger(__name__)

# name, industry, city, state, employees, revenue, founded, owner, title,
# family, generation, succession, hiring, copyright_year, pe_backed, tech, stage
SAMPLES = [
    ("Lone Star Comfort HVAC", "HVAC", "Austin", "TX", 48, 9_500_000, 1986, "Dale Whitaker", "Owner & President", True, "second", True, False, 2019, False, ["WordPress", "Google Analytics"], "new"),
    ("Gulf Breeze Plumbing Co.", "Plumbing", "Tampa", "FL", 32, 6_200_000, 1991, "Maria Alvarez", "Founder", True, None, False, True, 2025, False, ["WordPress", "ServiceTitan"], "contacted"),
    ("Peachtree Electric Services", "Electrical", "Marietta", "GA", 75, 14_800_000, 1979, "Robert Hayes", "CEO", True, "third", True, False, 2018, False, ["Wix"], "new"),
    ("Desert Oasis Landscaping", "Landscaping", "Scottsdale", "AZ", 60, 7_100_000, 2003, "Kevin Ortiz", "Owner", False, None, False, True, 2025, False, ["Squarespace", "Google Analytics", "Calendly"], "replied"),
    ("Smoky Mountain Pest Control", "Pest Control", "Knoxville", "TN", 22, 3_400_000, 1994, "Linda Carver", "President", True, None, False, False, 2020, False, ["GoDaddy Builder"], "new"),
    ("Carolina Ridge Roofing", "Roofing", "Raleigh", "NC", 41, 11_200_000, 1998, "James Pruitt", "Owner", False, None, False, True, 2024, False, ["WordPress", "HubSpot"], "meeting"),
    ("Bayou City Air & Heat", "HVAC", "Houston", "TX", 120, 22_000_000, 1972, "Thomas Nguyen", "Chairman", True, "second", True, True, 2023, False, ["WordPress", "Google Tag Manager", "ServiceTitan"], "new"),
    ("Sunshine State Electric", "Electrical", "Orlando", "FL", 18, 2_600_000, 2011, "Ashley Brooks", "Owner", False, None, False, False, 2022, False, ["Wix"], "new"),
    ("Magnolia Plumbing & Drain", "Plumbing", "Savannah", "GA", 27, 4_900_000, 1988, "Henry Collins", "Owner", True, None, True, False, 2017, False, ["WordPress"], "new"),
    ("Red Rock Pest Solutions", "Pest Control", "Phoenix", "AZ", 35, 5_300_000, 2006, "Carla Mendes", "General Manager", False, None, False, True, 2025, True, ["WordPress", "Salesforce", "Google Analytics"], "new"),
    ("Volunteer HVAC Pros", "HVAC", "Nashville", "TN", 55, 10_400_000, 1995, "Brian Tate", "Founder & CEO", False, None, False, True, 2025, False, ["Webflow", "HubSpot", "Housecall Pro"], "contacted"),
    ("Coastal Carolina Lawn Care", "Landscaping", "Wilmington", "NC", 14, 1_400_000, 2014, "Derek Simmons", "Owner", False, None, False, False, 2023, False, ["Squarespace"], "new"),
    ("Hill Country Roofing & Gutters", "Roofing", "San Antonio", "TX", 66, 13_500_000, 1983, "Gary Lindqvist", "President", True, "second", False, False, 2021, False, ["WordPress", "Meta Pixel"], "new"),
    ("Everglades Electric Contractors", "Electrical", "Fort Lauderdale", "FL", 90, 19_000_000, 1976, "Patricia Rowe", "Owner", True, None, True, True, 2024, False, ["WordPress", "Google Analytics"], "replied"),
    ("Blue Ridge Plumbing Partners", "Plumbing", "Asheville", "NC", 210, 41_000_000, 1990, None, None, False, None, False, True, 2025, True, ["Next.js", "Salesforce", "Segment"], "new"),
    ("Saguaro Air Conditioning", "HVAC", "Tucson", "AZ", 38, 7_800_000, 1989, "Ruben Castillo", "Owner", True, None, True, False, 2016, False, ["GoDaddy Builder"], "new"),
    ("Music City Landscapes", "Landscaping", "Franklin", "TN", 44, 5_900_000, 2001, "Hannah Price", "CEO", False, None, False, True, 2025, False, ["Wix", "Calendly"], "new"),
    ("Panhandle Pest & Termite", "Pest Control", "Pensacola", "FL", 29, 4_100_000, 1985, "Wayne Dobbs", "Owner", True, "second", True, False, 2019, False, ["WordPress"], "contacted"),
    ("Metro Atlanta Roofing Group", "Roofing", "Atlanta", "GA", 150, 31_000_000, 2008, None, None, False, None, False, True, 2025, True, ["React", "HubSpot", "Google Tag Manager"], "lost"),
    ("Brazos Valley Electric", "Electrical", "Waco", "TX", 25, 3_900_000, 1997, "Curtis Bell", "Owner", False, None, False, False, 2020, False, ["Squarespace"], "new"),
    ("Midwest Precision Machining", "Manufacturing", "Toledo", "OH", 85, 16_000_000, 1968, "Frank Kowalski", "President", True, "third", True, False, 2015, False, ["WordPress"], "new"),
    ("Pacific Crest Dental Lab", "Healthcare Services", "Portland", "OR", 30, 4_500_000, 1999, "Susan Lee", "Owner", False, None, False, True, 2024, False, ["Wix"], "new"),
    ("Keystone Commercial Cleaning", "Facility Services", "Pittsburgh", "PA", 140, 8_800_000, 1993, "Michael Russo", "CEO", True, None, False, True, 2025, False, ["WordPress", "Google Analytics"], "new"),
    ("Granite State IT Services", "IT Services", "Manchester", "NH", 24, 3_800_000, 2005, "Paul Gagnon", "Founder", False, None, False, True, 2025, False, ["WordPress", "HubSpot", "Intercom"], "new"),
    ("Tri-County Septic & Drain", "Plumbing", "Ocala", "FL", 16, 2_200_000, 1981, "Earl Jennings", "Owner", True, "second", True, False, 2014, False, [], "new"),
    ("Lakeshore Auto Collision", "Automotive", "Milwaukee", "WI", 33, 5_100_000, 1987, "Greg Novak", "Owner", True, None, False, False, 2021, False, ["GoDaddy Builder"], "new"),
    ("Triangle Mechanical Services", "HVAC", "Durham", "NC", 70, 12_900_000, 1984, "Steven Ward", "President", False, None, True, True, 2022, False, ["WordPress", "ServiceTitan", "Google Analytics"], "new"),
    ("Copper State Plumbing", "Plumbing", "Mesa", "AZ", 12, 1_100_000, 2018, "Jordan Fields", "Owner", False, None, False, True, 2025, False, ["Wix", "Housecall Pro"], "new"),
    ("Cumberland Lawn & Tree", "Landscaping", "Chattanooga", "TN", 52, 6_700_000, 1990, "Doris McCall", "Owner", True, "second", True, False, 2018, False, ["WordPress"], "new"),
    ("Space Coast Roofing", "Roofing", "Melbourne", "FL", 46, 9_200_000, 1992, "Victor Mancini", "Owner", False, None, False, True, 2025, False, ["WordPress", "Meta Pixel", "Calendly"], "new"),
]


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", name.lower().replace("&", "and"))[:40]


def seed_if_empty(db: Session) -> int:
    if (db.scalar(select(func.count(Lead.id))) or 0) > 0:
        return 0
    icp = get_icp(db)
    now = datetime.now(timezone.utc)
    for idx, (name, industry, city, state, emp, rev, founded, owner, title, family, gen, succession, hiring, cy, pe,
         tech, stage) in enumerate(SAMPLES):
        domain = f"{_slug(name)}.example"
        first = owner.split()[0].lower() if owner else None
        emails = [{"email": f"info@{domain}", "status": "risky", "reason": "Role-based inbox (sample data)",
                   "is_role": True, "is_free": False, "source": "sample"}]
        if first and idx % 3 != 2:  # realistic gaps: not every owner's direct email is known
            emails.insert(0, {"email": f"{first}@{domain}", "status": "valid", "reason": "Sample data",
                              "is_role": False, "is_free": False, "source": "sample"})
        signals = {
            "family_owned": family, "succession_language": succession, "hiring": hiring, "pe_backed": pe,
            "copyright_year": cy, "stale_website": cy <= now.year - 3, "owner_operated": not pe,
            "has_online_booking": any(t in tech for t in ("Calendly", "ServiceTitan", "Housecall Pro")),
            "sample": True,
        }
        if gen:
            signals["generation"] = gen
        lead = Lead(
            company_name=name, domain=domain, website=f"https://{domain}", industry=industry,
            description=f"{'Family-owned ' if family else ''}{industry if industry.isupper() else industry.lower()} company serving the {city} area since {founded}.",
            city=city, state=state, country="US", employee_count=emp, revenue_usd=rev, founded_year=founded,
            owner_name=owner, owner_title=title,
            phone=f"(555) {100 + len(name):03d}-{1000 + founded % 9000:04d}",
            linkedin_url=f"https://linkedin.com/company/{_slug(name)}",
            emails=emails, phones=[], socials={"linkedin": f"https://linkedin.com/company/{_slug(name)}"},
            tech_stack=tech, signals=signals, enrichment_status="enriched", enriched_at=now,
            stage=stage, tags=["sample"], source="sample",
        )
        apply_score(lead, icp)
        add_activity(lead, "created", "Added from the sample dataset")
        add_activity(lead, "enriched", f"Website enriched: {len(emails)} emails, {len(tech)} technologies")
        # Realistic follow-up state so the Action Center has something to show on first launch.
        if stage in ("contacted", "replied", "meeting", "lost"):
            contacted = now - timedelta(days=4 + idx % 5)
            lead.last_contacted_at = contacted
            add_activity(lead, "stage", "Stage changed: new → contacted", {"from": "new", "to": "contacted"})
            if stage == "contacted":
                # alternate overdue / upcoming
                lead.follow_up_at = now - timedelta(days=1 + idx % 3) if idx % 2 == 0 else now + timedelta(days=2)
            elif stage == "replied":
                lead.follow_up_at = now - timedelta(hours=6)
                add_activity(lead, "stage", "Stage changed: contacted → replied", {"from": "contacted", "to": "replied"})
        db.add(lead)
    db.commit()
    log.info("Seeded %d sample leads", len(SAMPLES))
    return len(SAMPLES)


if __name__ == "__main__":
    # `python -m app.db.seed` - run once at container start, before the web workers boot.
    from app.core.config import get_settings
    from app.db.session import SessionLocal

    logging.basicConfig(level=logging.INFO)
    if get_settings().seed_sample_data:
        with SessionLocal() as session:
            seed_if_empty(session)
