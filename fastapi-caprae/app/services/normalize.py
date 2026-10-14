"""Normalization helpers used for deduplication and clean data entry."""

import re
from urllib.parse import urlparse

_COMPANY_SUFFIXES = re.compile(
    r"\b(incorporated|inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|pllc|lp|llp|group|holdings)\b\.?",
    re.IGNORECASE,
)
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_DOMAIN_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")

US_STATES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA",
    "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD", "massachusetts": "MA",
    "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT",
    "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
    "new york": "NY", "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT",
    "virginia": "VA", "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
    "district of columbia": "DC",
}


def normalize_domain(value: str | None) -> str | None:
    """'https://www.Acme.com/about?x=1' -> 'acme.com'. Returns None when not a plausible domain."""
    if not value:
        return None
    raw = value.strip().lower()
    if "@" in raw and "/" not in raw:  # an email address was pasted
        raw = raw.split("@", 1)[1]
    if "://" not in raw:
        raw = "http://" + raw
    try:
        host = urlparse(raw).hostname or ""
    except ValueError:
        return None
    host = host.strip(".")
    if host.startswith("www."):
        host = host[4:]
    return host if _DOMAIN_RE.match(host) else None


def website_from_domain(domain: str | None) -> str | None:
    return f"https://{domain}" if domain else None


def normalize_company_name(name: str | None) -> str:
    """Canonical key for fuzzy duplicate detection: 'Acme Plumbing, LLC' -> 'acmeplumbing'."""
    if not name:
        return ""
    cleaned = _COMPANY_SUFFIXES.sub(" ", name.lower().replace("&", " and "))
    return _NON_ALNUM.sub("", cleaned)


def normalize_state(value: str | None) -> str | None:
    if not value:
        return None
    v = value.strip()
    if len(v) == 2:
        return v.upper()
    return US_STATES.get(v.lower(), v.title())


def normalize_phone(value: str | None) -> str | None:
    """Format US numbers as (555) 123-4567; leave international numbers readable."""
    if not value:
        return None
    digits = re.sub(r"\D", "", value)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        if digits[0] in "01" or digits[3] in "01":  # invalid NANP area code / exchange
            return None
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    if 8 <= len(digits) <= 15 and value.strip().startswith("+"):
        return "+" + digits
    return None


def clean_str(value: object, max_len: int | None = None) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() in {"nan", "none", "null", "n/a", "-"}:
        return None
    return s[:max_len] if max_len else s


def parse_int(value: object) -> int | None:
    """Parse '1,200', '$4.5M', '12k', '50-100' (takes midpoint) into an int."""
    s = clean_str(value)
    if s is None:
        return None
    s = s.lower().replace(",", "").replace("$", "").replace("usd", "").strip()
    if "-" in s:
        parts = [parse_int(p) for p in s.split("-", 1)]
        if all(p is not None for p in parts):
            return (parts[0] + parts[1]) // 2  # type: ignore[operator]
    s = s.rstrip("+")
    mult = 1
    if s.endswith("k"):
        mult, s = 1_000, s[:-1]
    elif s.endswith("m") or s.endswith("mm"):
        mult, s = 1_000_000, s.rstrip("m")
    elif s.endswith("b"):
        mult, s = 1_000_000_000, s[:-1]
    try:
        return int(float(s) * mult)
    except ValueError:
        return None
