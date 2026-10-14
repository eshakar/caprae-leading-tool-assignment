"""Email verification without sending mail: syntax -> disposable/role checks -> DNS MX lookup.

Results: "valid" (deliverable domain, personal mailbox), "risky" (role/catch-all style or no MX
but has A record), "invalid" (bad syntax, disposable, or domain cannot receive mail).
"""

import asyncio
import time
from dataclasses import asdict, dataclass

import dns.asyncresolver
import dns.exception
import dns.resolver
from email_validator import EmailNotValidError, validate_email

ROLE_PREFIXES = {
    "info", "sales", "support", "contact", "hello", "admin", "office", "team", "help", "service",
    "billing", "accounts", "careers", "jobs", "hr", "marketing", "press", "media", "noreply",
    "no-reply", "webmaster", "enquiries", "inquiries", "customerservice", "orders",
}
DISPOSABLE_DOMAINS = {
    "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org",
    "yopmail.com", "trashmail.com", "getnada.com", "sharklasers.com", "dispostable.com",
    "throwawaymail.com", "maildrop.cc", "fakeinbox.com",
}
FREE_PROVIDERS = {
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "live.com",
    "msn.com", "protonmail.com", "proton.me", "comcast.net", "att.net", "verizon.net",
}
# Strings that look like emails in page markup but are not real inboxes.
JUNK_EMAIL_HINTS = ("example.com", "domain.com", "email.com", "sentry", "wixpress.com", ".png", ".jpg",
                    ".gif", ".svg", ".webp", "yourname", "name@", "user@", "@2x")

_MX_CACHE: dict[str, tuple[float, bool, bool]] = {}
_MX_TTL_SECONDS = 6 * 3600


@dataclass
class EmailCheck:
    email: str
    status: str  # valid | risky | invalid
    reason: str
    is_role: bool = False
    is_free: bool = False
    source: str = "website"

    def to_dict(self) -> dict:
        return asdict(self)


def is_junk_email(email: str) -> bool:
    e = email.lower()
    return any(h in e for h in JUNK_EMAIL_HINTS)


async def _domain_mail_capability(domain: str) -> tuple[bool, bool]:
    """Returns (has_mx, has_a). Cached in-process to avoid repeated DNS lookups."""
    now = time.monotonic()
    cached = _MX_CACHE.get(domain)
    if cached and now - cached[0] < _MX_TTL_SECONDS:
        return cached[1], cached[2]

    resolver = dns.asyncresolver.Resolver()
    resolver.lifetime = 4.0
    has_mx = has_a = False
    try:
        answer = await resolver.resolve(domain, "MX")
        has_mx = any(str(r.exchange).strip(".") for r in answer)
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer, dns.resolver.NoNameservers,
            dns.exception.Timeout, dns.resolver.LifetimeTimeout):
        pass
    except Exception:  # noqa: BLE001 - DNS failures must never break enrichment
        pass
    if not has_mx:
        try:
            await resolver.resolve(domain, "A")
            has_a = True
        except Exception:  # noqa: BLE001
            has_a = False
    _MX_CACHE[domain] = (now, has_mx, has_a)
    return has_mx, has_a


async def verify_email(email: str, source: str = "website", check_dns: bool = True) -> EmailCheck:
    raw = email.strip()
    try:
        info = validate_email(raw, check_deliverability=False)
        normalized = info.normalized.lower()
        local, domain = info.local_part.lower(), info.domain.lower()
    except EmailNotValidError as exc:
        return EmailCheck(raw.lower(), "invalid", f"Bad syntax: {exc}", source=source)

    is_role = local.split("+")[0] in ROLE_PREFIXES
    is_free = domain in FREE_PROVIDERS

    if domain in DISPOSABLE_DOMAINS:
        return EmailCheck(normalized, "invalid", "Disposable email provider", is_role, is_free, source)
    if is_junk_email(normalized):
        return EmailCheck(normalized, "invalid", "Placeholder or asset filename, not an inbox", is_role, is_free, source)

    if check_dns:
        has_mx, has_a = await _domain_mail_capability(domain)
        if not has_mx and not has_a:
            return EmailCheck(normalized, "invalid", "Domain has no mail server (no MX/A record)", is_role, is_free, source)
        if not has_mx:
            return EmailCheck(normalized, "risky", "No MX record; relies on A-record fallback", is_role, is_free, source)

    if is_role:
        return EmailCheck(normalized, "risky", "Role-based inbox (shared mailbox, lower reply rate)", is_role, is_free, source)
    return EmailCheck(normalized, "valid", "Syntax OK, domain accepts mail" if check_dns else "Syntax OK",
                      is_role, is_free, source)


async def verify_many(emails: list[str], source: str = "website", check_dns: bool = True) -> list[EmailCheck]:
    seen: set[str] = set()
    unique = []
    for e in emails:
        k = e.strip().lower()
        if k and k not in seen:
            seen.add(k)
            unique.append(e)
    results = await asyncio.gather(*(verify_email(e, source, check_dns) for e in unique))
    order = {"valid": 0, "risky": 1, "invalid": 2}
    # Personal, valid inboxes first - that's what a salesperson or searcher wants to see.
    return sorted(results, key=lambda r: (order[r.status], r.is_role, r.email))
