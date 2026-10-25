import asyncio
import json
from types import SimpleNamespace

import httpx

from app.core.config import Settings
from app.models.icp import DEFAULT_WEIGHTS
from app.services import llm
from app.services.crawler import Crawler, EnrichmentResult
from app.services.email_validation import verify_email
from app.services.normalize import normalize_company_name, normalize_domain, normalize_phone, normalize_state, parse_int
from app.services import outreach as outreach_mod
from app.services.outreach import generate_outreach, template_outreach
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


def _hvac_lead():
    return SimpleNamespace(company_name="Lone Star HVAC", website="https://x.com", industry="HVAC", city="Austin",
                           state="TX", description=None, owner_name="Dale Whitaker", owner_title="Owner",
                           employee_count=40, founded_year=1986, signals={}, tech_stack=[], emails=[])


def test_ai_provider_selection():
    assert Settings(anthropic_api_key=None, gemini_api_key=None, xai_api_key=None).ai_provider is None
    xai = Settings(anthropic_api_key=None, gemini_api_key=None, xai_api_key="xai-test", xai_model="grok-test")
    assert (xai.ai_provider, xai.ai_model, xai.ai_enabled) == ("xai", "grok-test", True)
    assert Settings(anthropic_api_key="sk-ant-test", xai_api_key="xai-test").ai_provider == "anthropic"
    assert Settings(anthropic_api_key=None, gemini_api_key="g-test", xai_api_key="xai-test").ai_provider == "gemini"


def _with_xai(monkeypatch, handler):
    settings = Settings(anthropic_api_key=None, gemini_api_key=None, xai_api_key="xai-test", xai_model="grok-test")
    monkeypatch.setattr(llm, "get_settings", lambda: settings)
    monkeypatch.setattr(outreach_mod, "get_settings", lambda: settings)
    real_client = httpx.AsyncClient
    monkeypatch.setattr(llm.httpx, "AsyncClient",
                        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))


def test_xai_outreach_parses_structured_output(monkeypatch):
    package = {"subject": "Lone Star HVAC", "email_body": "Hi Dale,", "linkedin_note": "Hi", "call_opener": "Hi",
               "follow_up": "Hi", "personalization_points": ["Founded 1986"]}
    seen = {}

    def handler(request):
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"model": "grok-test", "choices": [
            {"finish_reason": "stop", "message": {"role": "assistant", "content": json.dumps(package)}}]})

    _with_xai(monkeypatch, handler)
    out = asyncio.run(generate_outreach(_hvac_lead(), "acquisition", "warm", None))
    assert out.generator == "grok-test" and out.subject == "Lone Star HVAC"
    assert seen["auth"] == "Bearer xai-test"
    assert seen["body"]["response_format"]["type"] == "json_schema"


def test_xai_error_falls_back_to_template(monkeypatch):
    _with_xai(monkeypatch, lambda request: httpx.Response(403, json={"code": "permission-denied"}))
    out = asyncio.run(generate_outreach(_hvac_lead(), "acquisition", "warm", None))
    assert out.generator == "template"


_PACKAGE = {"subject": "Lone Star HVAC", "email_body": "Hi Dale,", "linkedin_note": "Hi", "call_opener": "Hi",
            "follow_up": "Hi", "personalization_points": ["Founded 1986"]}


def _with_gemini(monkeypatch, handler):
    settings = Settings(anthropic_api_key=None, gemini_api_key="g-test", gemini_model="gemini-test",
                        gemini_fallback_models="gemini-backup, gemini-test")
    monkeypatch.setattr(llm, "get_settings", lambda: settings)
    monkeypatch.setattr(outreach_mod, "get_settings", lambda: settings)
    real_client = httpx.AsyncClient
    monkeypatch.setattr(llm.httpx, "AsyncClient",
                        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))


def test_gemini_outreach_parses_structured_output(monkeypatch):
    seen = {}

    def handler(request):
        seen["key"] = request.headers["x-goog-api-key"]
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"modelVersion": "gemini-test-001", "candidates": [
            {"finishReason": "STOP", "content": {"role": "model", "parts": [{"text": json.dumps(_PACKAGE)}]}}]})

    _with_gemini(monkeypatch, handler)
    out = asyncio.run(generate_outreach(_hvac_lead(), "acquisition", "warm", None))
    assert out.generator == "gemini-test-001" and out.subject == "Lone Star HVAC"
    assert seen["key"] == "g-test" and seen["path"].endswith("/models/gemini-test:generateContent")
    assert seen["body"]["generationConfig"]["responseMimeType"] == "application/json"


def test_gemini_tries_fallback_models_then_template(monkeypatch):
    tried = []

    def handler(request):
        tried.append(request.url.path.rsplit("/", 1)[-1])
        return httpx.Response(503, json={"error": {"status": "UNAVAILABLE"}})

    _with_gemini(monkeypatch, handler)
    out = asyncio.run(generate_outreach(_hvac_lead(), "acquisition", "warm", None))
    assert out.generator == "template"
    assert tried == ["gemini-test:generateContent", "gemini-backup:generateContent"]


INDUSTRIES = ["HVAC", "Plumbing", "IT Services", "Healthcare Services"]
STATES = ["TX", "FL", "OR", "IN"]


def test_rule_based_search_parses_common_phrasing():
    from app.services.ai_insights import rule_based_search

    f = rule_based_search("hot HVAC leads in Texas we haven't contacted, with email", INDUSTRIES, STATES)
    assert f["tiers"] == ["hot"] and f["industries"] == ["HVAC"] and f["states"] == ["TX"]
    assert f["stages"] == ["new"] and f["has_email"] is True
    # Lowercase "in"/"or" must never be read as Indiana/Oregon.
    g = rule_based_search("plumbing in florida or IT services scoring above 70", INDUSTRIES, STATES)
    assert sorted(g["industries"]) == ["IT Services", "Plumbing"] and g["states"] == ["FL"] and g["min_score"] == 70


def test_ai_search_filters_are_sanitised():
    from app.services.ai_insights import _clean_filters

    raw = {"tiers": ["hot", "lukewarm"], "stages": ["new"], "industries": ["hvac", "Bakeries"], "states": ["tx", "ZZ"],
           "min_score": 140, "has_email": True, "follow_up_due": False, "keywords": "family", "sort": "DROP TABLE"}
    f = _clean_filters(raw, INDUSTRIES, STATES)
    assert f["tiers"] == ["hot"] and f["industries"] == ["HVAC"] and f["states"] == ["TX"]
    assert f["min_score"] == 100 and f["sort"] == "-score"


def test_rule_based_brief_is_grounded():
    from app.services.ai_insights import rule_based_brief

    snap = {"totals": {"total": 10, "enriched": 10, "with_email": 8, "avg_score": 61.4},
            "by_tier": {"hot": 3, "warm": 4, "cold": 3}, "by_stage": {"new": 7},
            "by_industry": [{"industry": "HVAC", "count": 4, "avg_score": 80.0}],
            "follow_ups_due": [{"id": 7, "company_name": "Acme Air", "score": 82, "stage": "contacted", "days_overdue": 2}],
            "hot_untouched": [{"id": 3, "company_name": "Lone Star HVAC", "industry": "HVAC", "state": "TX", "score": 91}],
            "top_open_leads": []}
    b = rule_based_brief(snap)
    assert b["generator"] == "rules" and b["insights"][0]["lead_id"] == 7
    assert "3 hot leads out of 10" in b["headline"]
    assert any("2 leads have no email" in i["title"] for i in b["insights"])
