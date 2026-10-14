"""Polite website crawler + extractor that turns a company domain into sales/deal intelligence.

Pipeline: robots.txt check -> homepage -> discover about/contact/team/careers pages -> parallel fetch
-> extract (JSON-LD first, then markup, then visible text) -> merge + dedupe.
"""

import asyncio
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup

from app.core.config import get_settings
from app.services.normalize import normalize_domain, normalize_phone, normalize_state

MAX_BYTES = 2_000_000
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,24}")
OBFUSCATED_EMAIL_RE = re.compile(
    r"([A-Za-z0-9._%+\-]+)\s*(?:\[at\]|\(at\)|\{at\}|\s+at\s+)\s*([A-Za-z0-9\-]+)\s*(?:\[dot\]|\(dot\)|\{dot\}|\s+dot\s+)\s*([A-Za-z]{2,24})",
    re.IGNORECASE,
)
PHONE_RE = re.compile(r"(?:\+?1[\s.\-]?)?\(?\b[2-9]\d{2}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b")
FOUNDED_RE = re.compile(
    r"\b(?:founded|established|est\.?|since|serving [a-z ,]+ since|in business since|started in)\s*(?:in\s*)?((?:18|19|20)\d{2})\b",
    re.IGNORECASE,
)
COPYRIGHT_RE = re.compile(r"(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})", re.IGNORECASE)
GENERATION_RE = re.compile(r"\b(second|third|fourth|2nd|3rd|4th)[\s-]generation\b", re.IGNORECASE)

PAGE_HINTS = {
    "about": ("about", "our-story", "who-we-are", "company", "history"),
    "contact": ("contact", "get-in-touch", "locations", "reach-us"),
    "team": ("team", "leadership", "our-people", "staff", "management"),
    "careers": ("careers", "jobs", "join-us", "hiring", "employment"),
}

SOCIAL_PATTERNS = {
    "linkedin": re.compile(r"linkedin\.com/(company|in|school)/[^/?#\"']+", re.I),
    "facebook": re.compile(r"facebook\.com/(?!sharer|share|plugins|dialog|tr\b)[^/?#\"']+", re.I),
    "instagram": re.compile(r"instagram\.com/(?!p/|explore)[^/?#\"']+", re.I),
    "twitter": re.compile(r"(?:twitter|x)\.com/(?!share|intent|home)[A-Za-z0-9_]{1,15}\b", re.I),
    "youtube": re.compile(r"youtube\.com/(?:@|c/|channel/|user/)[^/?#\"']+", re.I),
    "yelp": re.compile(r"yelp\.com/biz/[^/?#\"']+", re.I),
}

# (label, category, substrings searched in raw HTML / script src / headers)
TECH_SIGNATURES: list[tuple[str, str, tuple[str, ...]]] = [
    ("WordPress", "CMS", ("wp-content", "wp-includes")),
    ("Shopify", "E-commerce", ("cdn.shopify.com", "myshopify.com")),
    ("Wix", "CMS", ("wixstatic.com", "wix.com")),
    ("Squarespace", "CMS", ("squarespace.com", "static1.squarespace")),
    ("Webflow", "CMS", ("webflow.com", "wf-page")),
    ("GoDaddy Builder", "CMS", ("img1.wsimg.com", "godaddy")),
    ("Next.js", "Framework", ("/_next/static", "__next_data__")),
    ("React", "Framework", ("react-dom", "data-reactroot")),
    ("Google Analytics", "Analytics", ("google-analytics.com", "gtag(", "googletagmanager.com/gtag")),
    ("Google Tag Manager", "Analytics", ("googletagmanager.com/gtm",)),
    ("Meta Pixel", "Advertising", ("connect.facebook.net", "fbq(")),
    ("Hotjar", "Analytics", ("hotjar.com",)),
    ("Segment", "Analytics", ("cdn.segment.com",)),
    ("HubSpot", "Marketing", ("js.hs-scripts.com", "hs-analytics", "hubspot")),
    ("Salesforce", "CRM", ("salesforce.com", "force.com", "pardot")),
    ("Marketo", "Marketing", ("marketo.net", "munchkin")),
    ("Mailchimp", "Marketing", ("mailchimp.com", "list-manage.com")),
    ("Klaviyo", "Marketing", ("klaviyo.com",)),
    ("Intercom", "Support", ("intercom.io", "widget.intercom")),
    ("Zendesk", "Support", ("zendesk.com", "zdassets.com")),
    ("Drift", "Support", ("drift.com", "js.driftt.com")),
    ("LiveChat", "Support", ("livechatinc.com",)),
    ("Stripe", "Payments", ("js.stripe.com",)),
    ("PayPal", "Payments", ("paypal.com/sdk", "paypalobjects.com")),
    ("Calendly", "Scheduling", ("calendly.com",)),
    ("ServiceTitan", "Field Service", ("servicetitan",)),
    ("Housecall Pro", "Field Service", ("housecallpro",)),
    ("Jobber", "Field Service", ("getjobber.com",)),
    ("Cloudflare", "Infrastructure", ("cdnjs.cloudflare.com", "cf-ray")),
]

FAMILY_RE = re.compile(r"\bfamily[\s-](?:owned|run|operated|business)\b", re.I)
VETERAN_RE = re.compile(r"\bveteran[\s-]owned\b", re.I)
WOMAN_RE = re.compile(r"\bwom[ae]n[\s-]owned\b", re.I)
OWNER_OPERATED_RE = re.compile(r"\b(?:owner[\s-]operated|locally owned|independently owned)\b", re.I)
PE_BACKED_RE = re.compile(
    r"\b(?:portfolio company of|backed by [A-Z][\w&]+ (?:capital|partners|equity)|private equity|acquired by|a (?:division|subsidiary) of|part of the [A-Z]\w+ family of)\b",
    re.I,
)
HIRING_RE = re.compile(r"\b(?:we(?:'|’)re hiring|now hiring|join our team|open positions|career opportunities)\b", re.I)
RETIRE_RE = re.compile(r"\b(?:retir(?:e|ing|ement)|succession|transition(?:ing)? ownership)\b", re.I)
CHALLENGE_HINTS = ("cf-chl", "challenge-platform", "captcha", "are you a robot", "access denied", "attention required")


@dataclass
class Page:
    status_code: int
    url: str
    headers: httpx.Headers
    text: str


@dataclass
class EnrichmentResult:
    domain: str
    ok: bool = False
    error: str | None = None
    final_url: str | None = None
    company_name: str | None = None
    description: str | None = None
    emails: list[str] = field(default_factory=list)
    phones: list[str] = field(default_factory=list)
    socials: dict[str, str] = field(default_factory=dict)
    tech_stack: list[str] = field(default_factory=list)
    city: str | None = None
    state: str | None = None
    founded_year: int | None = None
    employee_count: int | None = None
    owner_name: str | None = None
    signals: dict[str, Any] = field(default_factory=dict)
    pages_crawled: list[str] = field(default_factory=list)


class Crawler:
    def __init__(self) -> None:
        s = get_settings()
        self.settings = s
        self.client = httpx.AsyncClient(
            headers={
                "User-Agent": s.crawler_user_agent,
                "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.8",
            },
            timeout=httpx.Timeout(s.crawler_timeout_seconds, connect=5.0),
            follow_redirects=True,
            max_redirects=5,
            proxy=s.crawler_proxy_url or None,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )

    async def __aenter__(self) -> "Crawler":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.client.aclose()

    # ------------------------------------------------------------------ fetching
    async def _get(self, url: str, retries: int = 1) -> "Page | None":
        for attempt in range(retries + 1):
            try:
                async with self.client.stream("GET", url) as resp:
                    if resp.status_code in (429, 502, 503, 504) and attempt < retries:
                        await asyncio.sleep(1.5 * (attempt + 1))
                        continue
                    ctype = resp.headers.get("content-type", "")
                    if resp.status_code == 200 and ctype and "html" not in ctype and "text" not in ctype:
                        return None
                    body = bytearray()
                    async for chunk in resp.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > MAX_BYTES:
                            break
                    encoding = resp.charset_encoding or "utf-8"
                    return Page(
                        status_code=resp.status_code,
                        url=str(resp.url),
                        headers=resp.headers,
                        text=bytes(body).decode(encoding, errors="replace"),
                    )
            except (httpx.TimeoutException, httpx.TransportError):
                if attempt < retries:
                    await asyncio.sleep(1.0)
                    continue
                return None
            except (httpx.HTTPError, LookupError):
                return None
        return None

    async def _robots(self, base: str) -> RobotFileParser | None:
        if not self.settings.respect_robots_txt:
            return None
        resp = await self._get(urljoin(base, "/robots.txt"), retries=0)
        if resp is None or resp.status_code >= 400:
            return None
        parser = RobotFileParser()
        parser.parse(resp.text.splitlines())
        return parser

    # ------------------------------------------------------------------ main entry
    async def enrich(self, domain_or_url: str) -> EnrichmentResult:
        domain = normalize_domain(domain_or_url)
        if not domain:
            return EnrichmentResult(domain=domain_or_url, error="Not a valid domain")
        result = EnrichmentResult(domain=domain)
        if domain.endswith((".example", ".test", ".invalid", ".localhost")):
            result.error = "Sample data uses a reserved demo domain - add a real website to enrich"
            result.signals["reserved_domain"] = True
            return result

        home = None
        for base in (f"https://{domain}", f"https://www.{domain}", f"http://{domain}"):
            home = await self._get(base)
            if home is not None and home.status_code < 400:
                break
        if home is None:
            result.error = "Website unreachable (DNS, TLS or timeout)"
            return result
        if home.status_code in (401, 403, 429) or self._looks_like_challenge(home.text):
            result.error = f"Blocked by site protection (HTTP {home.status_code}); try again later or via proxy"
            result.signals["blocked"] = True
            return result
        if home.status_code >= 400:
            result.error = f"Website returned HTTP {home.status_code}"
            return result

        final_url = home.url
        result.final_url = final_url
        base = f"{urlparse(final_url).scheme}://{urlparse(final_url).netloc}"
        robots = await self._robots(base)
        ua = self.settings.crawler_user_agent

        pages: dict[str, str] = {"home": home.text}
        page_kinds = self._discover_pages(home.text, base)
        fetch_targets = []
        for kind, url in page_kinds.items():
            if robots is not None and not robots.can_fetch(ua, url):
                result.signals.setdefault("robots_skipped", []).append(url)
                continue
            fetch_targets.append((kind, url))
        fetch_targets = fetch_targets[: max(0, self.settings.crawler_max_pages - 1)]

        responses = await asyncio.gather(*(self._get(u) for _, u in fetch_targets))
        result.pages_crawled = [final_url]
        for (kind, url), resp in zip(fetch_targets, responses):
            if resp is not None and resp.status_code < 400 and resp.text:
                pages[kind] = resp.text
                result.pages_crawled.append(url)

        self._extract(result, pages, home.headers, domain)
        result.ok = True
        return result

    @staticmethod
    def _looks_like_challenge(html: str) -> bool:
        head = html[:5000].lower()
        return any(h in head for h in CHALLENGE_HINTS) and len(html) < 20000

    def _discover_pages(self, html: str, base: str) -> dict[str, str]:
        soup = BeautifulSoup(html, "html.parser")
        host = urlparse(base).netloc.removeprefix("www.")
        found: dict[str, str] = {}
        for a in soup.find_all("a", href=True):
            href = urljoin(base + "/", a["href"].strip())
            parsed = urlparse(href)
            if parsed.scheme not in ("http", "https") or parsed.netloc.removeprefix("www.") != host:
                continue
            path = parsed.path.lower().rstrip("/")
            text = a.get_text(" ", strip=True).lower()
            for kind, hints in PAGE_HINTS.items():
                if kind in found:
                    continue
                if any(h in path.rsplit("/", 1)[-1] for h in hints) or any(text == h.replace("-", " ") for h in hints):
                    found[kind] = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        # Fall back to conventional paths for the two pages that matter most.
        found.setdefault("contact", urljoin(base, "/contact"))
        found.setdefault("about", urljoin(base, "/about"))
        order = ["contact", "about", "team", "careers"]
        return {k: found[k] for k in order if k in found}

    # ------------------------------------------------------------------ extraction
    def _extract(self, r: EnrichmentResult, pages: dict[str, str], headers: httpx.Headers, domain: str) -> None:
        emails: list[str] = []
        phones: list[str] = []
        all_text_parts: list[str] = []
        raw_blob = " ".join(pages.values()).lower() + " " + " ".join(f"{k}:{v}" for k, v in headers.items()).lower()

        for kind, html in pages.items():
            soup = BeautifulSoup(html, "html.parser")
            self._extract_jsonld(r, soup, emails, phones)

            if kind == "home":
                r.company_name = r.company_name or self._site_name(soup)
                r.description = r.description or self._meta_description(soup)

            for a in soup.find_all("a", href=True):
                href = a["href"].strip()
                low = href.lower()
                if low.startswith("mailto:"):
                    emails.append(low[7:].split("?")[0])
                elif low.startswith("tel:"):
                    phones.append(href[4:])
                else:
                    for net, pat in SOCIAL_PATTERNS.items():
                        if net not in r.socials:
                            m = pat.search(href)
                            if m:
                                r.socials[net] = "https://" + m.group(0).rstrip("/")

            for tag in soup(["script", "style", "noscript", "svg"]):
                tag.decompose()
            text = soup.get_text(" ", strip=True)
            all_text_parts.append(text)
            emails.extend(EMAIL_RE.findall(text))
            for m in OBFUSCATED_EMAIL_RE.finditer(text):
                emails.append(f"{m.group(1)}@{m.group(2)}.{m.group(3)}")
            if kind in ("home", "contact"):
                phones.extend(PHONE_RE.findall(text))

        full_text = " ".join(all_text_parts)

        # Emails: keep ones on the company domain first, drop junk.
        cleaned = []
        for e in emails:
            e = e.strip().strip(".").lower()
            if EMAIL_RE.fullmatch(e) and e not in cleaned:
                cleaned.append(e)
        on_domain = [e for e in cleaned if e.endswith("@" + domain) or e.endswith("." + domain)]
        off_domain = [e for e in cleaned if e not in on_domain]
        r.emails = (on_domain + off_domain)[:15]

        normalized_phones: list[str] = []
        for p in phones:
            n = normalize_phone(p)
            if n and n not in normalized_phones:
                normalized_phones.append(n)
        r.phones = normalized_phones[:5]

        r.tech_stack = [label for label, _cat, needles in TECH_SIGNATURES if any(n in raw_blob for n in needles)]

        # ---- deal / buying signals
        years = [int(y) for y in FOUNDED_RE.findall(full_text) if 1800 <= int(y) <= datetime.now().year]
        if years and not r.founded_year:
            r.founded_year = min(years)
        copyright_years = [int(y) for y in COPYRIGHT_RE.findall(" ".join(pages.values()))]
        current_year = datetime.now(timezone.utc).year
        sig = r.signals
        if copyright_years:
            latest = max(y for y in copyright_years if y <= current_year + 1) if any(
                y <= current_year + 1 for y in copyright_years) else None
            if latest:
                sig["copyright_year"] = latest
                sig["stale_website"] = latest <= current_year - 3
        sig["family_owned"] = bool(FAMILY_RE.search(full_text))
        gen = GENERATION_RE.search(full_text)
        if gen:
            sig["generation"] = gen.group(1).lower()
        sig["veteran_owned"] = bool(VETERAN_RE.search(full_text))
        sig["woman_owned"] = bool(WOMAN_RE.search(full_text))
        sig["owner_operated"] = bool(OWNER_OPERATED_RE.search(full_text))
        sig["pe_backed"] = bool(PE_BACKED_RE.search(full_text))
        sig["hiring"] = "careers" in pages or bool(HIRING_RE.search(full_text))
        sig["succession_language"] = bool(RETIRE_RE.search(full_text))
        sig["has_https"] = (r.final_url or "").startswith("https://")
        sig["has_online_booking"] = any(t in r.tech_stack for t in ("Calendly", "ServiceTitan", "Housecall Pro", "Jobber"))
        sig["pages_crawled"] = len(pages)
        sig["enriched_at"] = datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _site_name(soup: BeautifulSoup) -> str | None:
        og = soup.find("meta", property="og:site_name")
        if og and og.get("content"):
            return og["content"].strip()[:255]
        if soup.title and soup.title.string:
            title = re.split(r"\s+[|\-–—:]\s+", soup.title.string.strip())[0]
            return title[:255] or None
        return None

    @staticmethod
    def _meta_description(soup: BeautifulSoup) -> str | None:
        for attrs in ({"name": "description"}, {"property": "og:description"}):
            tag = soup.find("meta", attrs=attrs)
            if tag and tag.get("content"):
                return tag["content"].strip()[:1000]
        return None

    def _extract_jsonld(self, r: EnrichmentResult, soup: BeautifulSoup, emails: list[str], phones: list[str]) -> None:
        """schema.org Organization / LocalBusiness data is the most reliable source when present."""
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string or "")
            except (json.JSONDecodeError, TypeError):
                continue
            nodes = data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []
            for node in nodes:
                if not isinstance(node, dict):
                    continue
                types = node.get("@type", "")
                types = types if isinstance(types, list) else [types]
                if not any(t in ("Organization", "LocalBusiness", "Corporation") or "Business" in str(t)
                           or "Contractor" in str(t) or "Service" in str(t) for t in types):
                    continue
                if node.get("name") and not r.company_name:
                    r.company_name = str(node["name"])[:255]
                if node.get("description") and not r.description:
                    r.description = str(node["description"])[:1000]
                if node.get("email"):
                    emails.append(str(node["email"]).replace("mailto:", ""))
                if node.get("telephone"):
                    phones.append(str(node["telephone"]))
                founding = str(node.get("foundingDate") or "")
                if founding[:4].isdigit():
                    r.founded_year = int(founding[:4])
                emp = node.get("numberOfEmployees")
                if isinstance(emp, dict):
                    emp = emp.get("value") or emp.get("maxValue")
                if isinstance(emp, (int, str)) and str(emp).isdigit():
                    r.employee_count = int(emp)
                founder = node.get("founder")
                if isinstance(founder, list) and founder:
                    founder = founder[0]
                if isinstance(founder, dict) and founder.get("name"):
                    r.owner_name = str(founder["name"])[:255]
                elif isinstance(founder, str):
                    r.owner_name = founder[:255]
                addr = node.get("address")
                if isinstance(addr, list) and addr:
                    addr = addr[0]
                if isinstance(addr, dict):
                    r.city = r.city or addr.get("addressLocality")
                    r.state = r.state or normalize_state(addr.get("addressRegion"))
                for same in node.get("sameAs", []) if isinstance(node.get("sameAs"), list) else []:
                    for net, pat in SOCIAL_PATTERNS.items():
                        m = pat.search(str(same))
                        if m and net not in r.socials:
                            r.socials[net] = "https://" + m.group(0).rstrip("/")


async def enrich_domain(domain: str) -> EnrichmentResult:
    async with Crawler() as crawler:
        return await crawler.enrich(domain)
