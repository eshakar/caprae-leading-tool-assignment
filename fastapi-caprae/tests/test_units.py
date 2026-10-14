import asyncio
from types import SimpleNamespace

import httpx

from app.models.icp import DEFAULT_WEIGHTS
from app.services.crawler import Crawler, EnrichmentResult
from app.services.email_validation import verify_email
from app.services.normalize import normalize_company_name, normalize_domain, normalize_phone, normalize_state, parse_int
from app.services.outreach import template_outreach
from app.services.scoring import normalized_weights, score_lead


def test_normalize_domain():
    assert normalize_domain("https://www.Acme.com/about?x=1") == "acme.com"
    assert normalize_domain("acme.co.uk") == "acme.co.uk"
    assert normalize_domain("jane@acme.io") == "acme.io"
    assert normalize_domain("not a domain") is None
    assert normalize_domain("") is None


def test_company_name_key_dedupes_suffixes():
    assert normalize_company_name("Acme Plumbing, LLC") == normalize_company_name("ACME Plumbing Inc.")
    assert normalize_company_name("Smith & Sons") == normalize_company_name("Smith and Sons Co")


def test_phone_state_int_parsing():
    assert normalize_phone("+1 (512) 555-0199") == "(512) 555-0199"
    assert normalize_phone("123") is None
    assert normalize_state("texas") == "TX"
    assert normalize_state("fl") == "FL"
    assert parse_int("$4.5M") == 4_500_000
    assert parse_int("1,200") == 1200
    assert parse_int("11-50") == 30
    assert parse_int("12k") == 12_000
    assert parse_int("n/a") is None


def test_email_verification_without_dns():
    r = asyncio.run(verify_email("Jane.Doe@acme.com", check_dns=False))
    assert r.status == "valid" and not r.is_role
    assert asyncio.run(verify_email("info@acme.com", check_dns=False)).status == "risky"
    assert asyncio.run(verify_email("x@mailinator.com", check_dns=False)).status == "invalid"
    assert asyncio.run(verify_email("bad@@acme", check_dns=False)).status == "invalid"
    assert asyncio.run(verify_email("logo@2x.png", check_dns=False)).status == "invalid"


def _icp(**kw):
    base = dict(mode="acquisition", target_industries=["HVAC"], target_states=["TX"], min_employees=10,
                max_employees=100, min_revenue=2_000_000, max_revenue=20_000_000, min_years_in_business=10,
                weights=dict(DEFAULT_WEIGHTS))
    base.update(kw)
    return SimpleNamespace(**base)


def _lead(**kw):
    base = dict(industry="HVAC", state="TX", employee_count=40, revenue_usd=8_000_000, founded_year=1985,
                owner_name="Dale Smith", phone="(512) 555-0100", linkedin_url=None,
                emails=[{"email": "dale@x.com", "status": "valid", "is_role": False}], phones=[], socials={},
                tech_stack=["WordPress"], signals={"family_owned": True, "succession_language": True})
    base.update(kw)
    return SimpleNamespace(**base)


def test_weights_normalize_to_100():
    assert round(sum(normalized_weights({"industry_fit": 50}).values())) == 100
    assert round(sum(normalized_weights({k: 0 for k in DEFAULT_WEIGHTS}).values())) == 100


def test_score_ideal_lead_is_hot_and_explained():
    score, tier, breakdown = score_lead(_lead(), _icp())
    assert tier == "hot" and score >= 75
    assert all(f["reason"] for f in breakdown)
    assert round(sum(f["max"] for f in breakdown)) == 100


def test_knockouts_cap_score():
    off_industry, _, b1 = score_lead(_lead(industry="Bakery"), _icp())
    assert off_industry <= 55 and any(f["key"] == "knockout" for f in b1)
    pe, tier, _ = score_lead(_lead(signals={"pe_backed": True}), _icp())
    assert pe <= 40 and tier == "cold"


def test_unknown_data_scores_lower_than_known():
    known, _, _ = score_lead(_lead(), _icp())
    unknown, _, _ = score_lead(_lead(employee_count=None, revenue_usd=None, founded_year=None, emails=[],
                                     phone=None, owner_name=None, signals={}), _icp())
    assert unknown < known


def test_sales_mode_uses_buying_triggers():
    _, _, breakdown = score_lead(_lead(signals={"hiring": True}), _icp(mode="sales"))
    assert any(f["label"] == "Buying triggers" for f in breakdown)


HTML_HOME = """
<html><head><title>Lone Star HVAC | Austin Heating & Cooling</title>
<meta name="description" content="Family-owned HVAC company serving Austin since 1986.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"HVACBusiness","name":"Lone Star HVAC",
"telephone":"+1-512-555-0142","foundingDate":"1986","founder":{"@type":"Person","name":"Dale Whitaker"},
"address":{"@type":"PostalAddress","addressLocality":"Austin","addressRegion":"Texas"},
"sameAs":["https://www.facebook.com/lonestarhvac","https://www.linkedin.com/company/lone-star-hvac"]}</script>
<script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
<link rel="stylesheet" href="/wp-content/themes/x/style.css"></head>
<body><a href="/contact">Contact</a><a href="/careers">Careers</a>
<p>A family-owned, second-generation business. Email dale [at] lonestarhvac [dot] com</p>
<a href="mailto:service@lonestarhvac.com">Email us</a>
<footer>&copy; 2019 Lone Star HVAC</footer></body></html>
"""
HTML_CONTACT = "<html><body><p>Call (512) 555-0142 or write to office@lonestarhvac.com</p><img src='logo@2x.png'></body></html>"


def test_extraction_from_markup():
    async def run() -> EnrichmentResult:
        crawler = Crawler()
        try:
            r = EnrichmentResult(domain="lonestarhvac.com", final_url="https://lonestarhvac.com")
            crawler._extract(r, {"home": HTML_HOME, "contact": HTML_CONTACT, "careers": "<p>Join our team</p>"},
                             httpx.Headers({"server": "nginx"}), "lonestarhvac.com")
            return r
        finally:
            await crawler.client.aclose()

    r = asyncio.run(run())
    assert r.company_name == "Lone Star HVAC"
    assert r.founded_year == 1986
    assert r.owner_name == "Dale Whitaker"
    assert r.state == "TX" and r.city == "Austin"
    assert "dale@lonestarhvac.com" in r.emails and "service@lonestarhvac.com" in r.emails
    assert "office@lonestarhvac.com" in r.emails
    assert "(512) 555-0142" in r.phones and len(r.phones) == 1  # deduped across JSON-LD + text
    assert {"facebook", "linkedin"} <= set(r.socials)
    assert "WordPress" in r.tech_stack and "Google Analytics" in r.tech_stack
    assert r.signals["family_owned"] and r.signals["generation"] == "second"
    assert r.signals["hiring"] and r.signals["copyright_year"] == 2019 and r.signals["stale_website"]


def test_crawler_handles_blocked_site():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="<html>Attention Required! | Cloudflare</html>",
                              headers={"content-type": "text/html"})

    async def run():
        crawler = Crawler()
        await crawler.client.aclose()
        crawler.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            return await crawler.enrich("blocked-example.com")
        finally:
            await crawler.client.aclose()

    r = asyncio.run(run())
    assert not r.ok and "Blocked" in (r.error or "") and r.signals.get("blocked")


def test_template_outreach_is_grounded():
    lead = SimpleNamespace(company_name="Lone Star HVAC", website="https://x.com", industry="HVAC", city="Austin",
                           state="TX", description=None, owner_name="Dale Whitaker", owner_title="Owner",
                           employee_count=40, founded_year=1986, signals={"family_owned": True}, tech_stack=[],
                           emails=[])
    out = template_outreach(lead, "acquisition", "warm", None)
    assert "Hi Dale," in out.email_body and "Lone Star HVAC" in out.email_body
    assert len(out.linkedin_note) <= 300 and out.generator == "template"
