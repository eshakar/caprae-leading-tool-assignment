"""Provider-agnostic structured-output LLM calls (Claude, Gemini, Grok).

Every AI feature asks for JSON matching a schema and gets back a plain dict, so features never depend on
which provider is configured. Any provider failure is raised as `LLMUnavailable`; callers catch it and fall
back to their deterministic (non-AI) implementation, so the product keeps working without an API key.
"""

import json
import logging
from typing import Any

import anthropic
import httpx

from app.core.config import get_settings

log = logging.getLogger(__name__)


class LLMUnavailable(Exception):
    """The configured provider could not produce a usable answer (no key, outage, quota, bad output)."""


async def generate_json(system: str, user: str, schema: dict[str, Any], *, name: str = "response",
                        max_tokens: int = 4000) -> tuple[dict[str, Any], str]:
    """Returns (parsed JSON, model name). Raises LLMUnavailable on any failure."""
    provider = get_settings().ai_provider
    try:
        if provider == "anthropic":
            return await _claude(system, user, schema, max_tokens)
        if provider == "gemini":
            return await _gemini(system, user, schema, max_tokens)
        if provider == "xai":
            return await _xai(system, user, schema, name, max_tokens)
    except anthropic.APIConnectionError as exc:
        raise LLMUnavailable("Claude unreachable") from exc
    except anthropic.RateLimitError as exc:
        raise LLMUnavailable("Claude rate limited") from exc
    except anthropic.APIStatusError as exc:
        raise LLMUnavailable(f"Claude API error {exc.status_code}") from exc
    except httpx.HTTPStatusError as exc:
        raise LLMUnavailable(f"{provider} API error {exc.response.status_code}") from exc
    except httpx.HTTPError as exc:
        raise LLMUnavailable(f"{provider} unreachable ({type(exc).__name__})") from exc
    except (ValueError, KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise LLMUnavailable(f"Unusable {provider} response ({exc})") from exc
    raise LLMUnavailable("No AI provider configured")


async def _claude(system: str, user: str, schema: dict[str, Any], max_tokens: int) -> tuple[dict[str, Any], str]:
    settings = get_settings()
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=60.0, max_retries=2)
    response = await client.beta.messages.create(
        model=settings.anthropic_model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
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
    return json.loads(text), response.model


async def _gemini(system: str, user: str, schema: dict[str, Any], max_tokens: int) -> tuple[dict[str, Any], str]:
    """Google Gemini via the native generateContent API with JSON-schema structured output."""
    settings = get_settings()
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {
            # Gemini counts thinking tokens against this limit, so leave headroom beyond the answer itself.
            "maxOutputTokens": max_tokens + 4000,
            "thinkingConfig": {"thinkingLevel": "low"},
            "responseMimeType": "application/json",
            "responseJsonSchema": schema,
        },
    }
    # Gemini models are often briefly overloaded (503) or rate limited (429): walk the fallback chain.
    models = [settings.gemini_model, *(m.strip() for m in settings.gemini_fallback_models.split(",") if m.strip())]
    async with httpx.AsyncClient(base_url=settings.gemini_base_url, timeout=60.0) as client:
        for model in dict.fromkeys(models):
            response = await client.post(
                f"/models/{model}:generateContent",
                json=payload,
                headers={"x-goog-api-key": settings.gemini_api_key or ""},
            )
            if response.status_code not in (429, 500, 503):
                break
            log.info("Gemini %s returned %s; trying the next model", model, response.status_code)
    response.raise_for_status()
    body = response.json()
    if not body.get("candidates"):
        raise ValueError(f"No candidates (prompt feedback: {body.get('promptFeedback')})")
    candidate = body["candidates"][0]
    if candidate.get("finishReason") not in (None, "STOP"):
        raise ValueError(f"Generation stopped: {candidate['finishReason']}")
    text = "".join(p.get("text", "") for p in candidate["content"]["parts"] if not p.get("thought"))
    return json.loads(text), body.get("modelVersion") or settings.gemini_model


async def _xai(system: str, user: str, schema: dict[str, Any], name: str, max_tokens: int) -> tuple[dict[str, Any], str]:
    """xAI Grok via its OpenAI-compatible Chat Completions API with JSON-schema structured output."""
    settings = get_settings()
    payload = {
        "model": settings.xai_model,
        "max_tokens": max_tokens,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}},
    }
    async with httpx.AsyncClient(base_url=settings.xai_base_url, timeout=60.0) as client:
        response = await client.post(
            "/chat/completions", json=payload, headers={"Authorization": f"Bearer {settings.xai_api_key}"}
        )
    response.raise_for_status()
    body = response.json()
    choice = body["choices"][0]
    if choice.get("finish_reason") == "length":
        raise ValueError("Response truncated")
    message = choice["message"]
    if message.get("refusal"):
        raise ValueError("Model declined the request")
    return json.loads(message["content"]), body.get("model") or settings.xai_model
