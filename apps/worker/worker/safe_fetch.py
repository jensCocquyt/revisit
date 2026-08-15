"""SSRF-guarded fetching of link URLs.

HTTP/HTTPS only. Every hop — the original URL and each redirect target — has
its hostname resolved and all resolved addresses validated against blocked
ranges before a connection is made. Redirects are followed manually so that
revalidation cannot be skipped. Response size, total duration, and content
type are bounded. Callers must never run this inside a database transaction.
"""

from __future__ import annotations

import ipaddress
import socket
import time
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

import httpx

from worker import config
from worker.errors import FetchTerminalError, FetchTransientError

USER_AGENT = "revisit-worker/0.1 (link enrichment)"

Resolver = Callable[[str], list[str]]


def fetch_page(
    url: str,
    *,
    limits: FetchLimits | None = None,
    resolver: Resolver | None = None,
    transport: httpx.BaseTransport | None = None,
) -> FetchedPage:
    """Fetch one URL through the guard, following redirects manually."""
    limits = limits or limits_from_env()
    resolver = resolver or default_resolver
    started = time.monotonic()
    current = url
    with httpx.Client(
        transport=transport,
        follow_redirects=False,
        headers={"user-agent": USER_AGENT},
    ) as client:
        for _hop in range(limits.max_redirects + 1):
            validate_url(current, limits, resolver)
            remaining = limits.timeout_seconds - (time.monotonic() - started)
            if remaining <= 0:
                raise FetchTransientError("fetch_timeout", f"budget exceeded before {current}")
            try:
                with client.stream("GET", current, timeout=remaining) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise FetchTransientError(
                                "fetch_http_error", f"redirect without location from {current}"
                            )
                        current = urljoin(current, location)
                        continue
                    return _read_response(response, current, limits, started)
            except httpx.TimeoutException as exc:
                raise FetchTransientError("fetch_timeout", f"{current}: {exc}") from exc
            except httpx.HTTPError as exc:
                raise FetchTransientError(
                    "fetch_http_error", f"{current}: {type(exc).__name__}: {exc}"
                ) from exc
    raise FetchTerminalError("too_many_redirects", f"more than {limits.max_redirects} redirects")


def validate_url(url: str, limits: FetchLimits, resolver: Resolver | None = None) -> str:
    """Validate scheme and destination addresses for one hop. Returns the host."""
    host = _parse_host(url)
    if host in limits.allowed_hosts:
        # Test/CI escape hatch for in-network fixtures: skips only the address
        # check; scheme and all response limits still apply.
        return host
    for addr in _resolve_addresses(host, resolver or default_resolver):
        if _is_blocked(addr):
            raise FetchTerminalError("blocked_url", f"{host} resolves to blocked address {addr}")
    return host


def default_resolver(host: str) -> list[str]:
    infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    return sorted({info[4][0] for info in infos})


def limits_from_env() -> FetchLimits:
    return FetchLimits(
        max_redirects=config.fetch_max_redirects(),
        max_bytes=config.fetch_max_bytes(),
        timeout_seconds=config.fetch_timeout_seconds(),
        allowed_content_types=config.fetch_allowed_content_types(),
        allowed_hosts=config.fetch_allowed_hosts(),
    )


@dataclass(frozen=True)
class FetchLimits:
    max_redirects: int
    max_bytes: int
    timeout_seconds: float
    allowed_content_types: frozenset[str]
    allowed_hosts: frozenset[str]


@dataclass(frozen=True)
class FetchedPage:
    url: str  # final URL after redirects
    body: str
    content_type: str


def _parse_host(url: str) -> str:
    """Parse one hop's URL and gate scheme and hostname; terminal on any defect."""
    try:
        parts = urlsplit(url)
        host = parts.hostname
    except ValueError as exc:
        raise FetchTerminalError("invalid_url", str(exc)[:200]) from exc
    if parts.scheme not in ("http", "https"):
        raise FetchTerminalError("invalid_url", f"scheme {parts.scheme or '(none)'!r} not allowed")
    if not host:
        raise FetchTerminalError("invalid_url", "no hostname")
    return host


def _resolve_addresses(
    host: str, resolver: Resolver
) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    """Candidate addresses for a host: the literal IP, or every resolved address.

    DNS problems (lookup failure, empty answer, unparseable record) are
    transient — they heal on retry, unlike the terminal verdicts around them.
    """
    try:
        return [ipaddress.ip_address(host.split("%", 1)[0])]
    except ValueError:
        pass  # not a literal IP: resolve it as a name
    try:
        resolved = resolver(host)
    except OSError as exc:
        raise FetchTransientError("fetch_dns_error", f"{host}: {exc}") from exc
    if not resolved:
        raise FetchTransientError("fetch_dns_error", f"{host}: no addresses")
    try:
        return [ipaddress.ip_address(a.split("%", 1)[0]) for a in resolved]
    except ValueError as exc:
        raise FetchTransientError("fetch_dns_error", f"{host}: {exc}") from exc


def _is_blocked(addr: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    # Only plainly public addresses pass. `is_global` rejects loopback, private,
    # link-local (cloud metadata), and reserved ranges; multicast gets its own
    # check because some multicast ranges count as global.
    mapped = addr.ipv4_mapped if isinstance(addr, ipaddress.IPv6Address) else None
    if mapped is not None:
        addr = mapped
    return not addr.is_global or addr.is_multicast


def _read_response(
    response: httpx.Response, url: str, limits: FetchLimits, started: float
) -> FetchedPage:
    if response.status_code != 200:
        raise FetchTransientError("fetch_http_error", f"{url}: status {response.status_code}")

    content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type not in limits.allowed_content_types:
        raise FetchTerminalError(
            "unsupported_content_type", f"{content_type or '(none)'} from {url}"
        )

    declared = response.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limits.max_bytes:
        raise FetchTerminalError("content_too_large", f"declared {declared} bytes from {url}")

    body = bytearray()
    for chunk in response.iter_bytes():
        body.extend(chunk)
        if len(body) > limits.max_bytes:
            raise FetchTerminalError("content_too_large", f"body exceeds {limits.max_bytes} bytes")
        if time.monotonic() - started > limits.timeout_seconds:
            raise FetchTransientError("fetch_timeout", f"budget exceeded reading {url}")
    return FetchedPage(
        url=url,
        body=bytes(body).decode(response.charset_encoding or "utf-8", errors="replace"),
        content_type=content_type,
    )
