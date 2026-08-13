"""Offline tests for the SSRF guard and the guarded fetch loop.

No network: address validation uses a fake resolver and HTTP behavior comes
from httpx.MockTransport.
"""

import socket
from dataclasses import replace

import httpx
import pytest

from worker.safe_fetch import (
    FetchedPage,
    FetchLimits,
    FetchTerminalError,
    FetchTransientError,
    fetch_page,
    validate_url,
)

LIMITS = FetchLimits(
    max_redirects=3,
    max_bytes=1_000,
    timeout_seconds=5.0,
    allowed_content_types=frozenset({"text/html", "application/xhtml+xml", "text/plain"}),
    allowed_hosts=frozenset(),
)

PUBLIC_V4 = "93.184.216.34"
PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946"


def resolver(mapping: dict[str, list[str]]):
    def resolve(host: str) -> list[str]:
        if host not in mapping:
            raise socket.gaierror(f"name resolution failed for {host}")
        return mapping[host]

    return resolve


def never_resolves(host: str) -> list[str]:
    raise AssertionError(f"resolver must not be called for {host}")


class TestErrorFormat:
    def test_matches_last_error_shape(self):
        assert str(FetchTerminalError("blocked_url", "host x")) == "blocked_url: host x"
        assert str(FetchTransientError("fetch_timeout", "slow")) == "fetch_timeout: slow"


class TestGuardMatrix:
    @pytest.mark.parametrize(
        "address",
        [
            "169.254.169.254",  # cloud metadata (link-local)
            "10.0.0.5",  # private
            "172.16.0.1",  # private
            "192.168.1.10",  # private
            "127.0.0.1",  # loopback v4
            "::1",  # loopback v6
            "224.0.0.1",  # multicast
            "0.0.0.0",  # unspecified
            "fd00::1",  # private v6
            "::ffff:10.0.0.5",  # v4-mapped private
        ],
    )
    def test_blocked_resolved_address(self, address: str):
        with pytest.raises(FetchTerminalError, match="^blocked_url"):
            validate_url("https://site.example/page", LIMITS, resolver({"site.example": [address]}))

    @pytest.mark.parametrize("address", ["169.254.169.254", "10.0.0.5", "[::1]"])
    def test_blocked_literal_ip(self, address: str):
        with pytest.raises(FetchTerminalError, match="^blocked_url"):
            validate_url(f"http://{address}/latest/meta-data/", LIMITS, never_resolves)

    def test_one_blocked_address_among_many_blocks(self):
        mapping = {"site.example": [PUBLIC_V4, "10.0.0.5"]}
        with pytest.raises(FetchTerminalError, match="^blocked_url"):
            validate_url("https://site.example/", LIMITS, resolver(mapping))

    @pytest.mark.parametrize("address", [PUBLIC_V4, PUBLIC_V6])
    def test_public_address_allowed(self, address: str):
        host = validate_url("https://site.example/", LIMITS, resolver({"site.example": [address]}))
        assert host == "site.example"

    def test_allowlisted_host_skips_address_check(self):
        limits = replace(LIMITS, allowed_hosts=frozenset({"api"}))
        assert validate_url("http://api:3000/docs", limits, never_resolves) == "api"

    @pytest.mark.parametrize("url", ["ftp://example.com/file", "file:///etc/passwd", "not a url"])
    def test_non_http_scheme_rejected(self, url: str):
        with pytest.raises(FetchTerminalError, match="^invalid_url"):
            validate_url(url, LIMITS, never_resolves)

    def test_missing_hostname_rejected(self):
        with pytest.raises(FetchTerminalError, match="^invalid_url"):
            validate_url("http:///path-only", LIMITS, never_resolves)

    def test_dns_failure_is_transient(self):
        with pytest.raises(FetchTransientError, match="^fetch_dns_error"):
            validate_url("https://nope.example/", LIMITS, resolver({}))


def fetch(handler, url="https://site.example/", mapping=None, limits=LIMITS) -> FetchedPage:
    mapping = mapping if mapping is not None else {"site.example": [PUBLIC_V4]}
    return fetch_page(
        url,
        limits=limits,
        resolver=resolver(mapping),
        transport=httpx.MockTransport(handler),
    )


def html_response(body: str = "<html>ok</html>", **kwargs) -> httpx.Response:
    kwargs.setdefault("headers", {"content-type": "text/html; charset=utf-8"})
    return httpx.Response(200, content=body.encode(), **kwargs)


class TestFetchLoop:
    def test_success_returns_body_and_type(self):
        page = fetch(lambda request: html_response("<html>hello</html>"))
        assert page == FetchedPage(
            url="https://site.example/", body="<html>hello</html>", content_type="text/html"
        )

    def test_valid_redirect_within_limit_succeeds(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.host == "site.example":
                return httpx.Response(301, headers={"location": "https://other.example/page"})
            return html_response("<html>moved here</html>")

        mapping = {"site.example": [PUBLIC_V4], "other.example": [PUBLIC_V4]}
        page = fetch(handler, mapping=mapping)
        assert page.url == "https://other.example/page"
        assert page.body == "<html>moved here</html>"

    def test_redirect_to_blocked_address_is_caught(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(302, headers={"location": "http://169.254.169.254/"})

        with pytest.raises(FetchTerminalError, match="^blocked_url"):
            fetch(handler)

    def test_redirect_to_unresolvable_host_is_transient(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(302, headers={"location": "https://internal.example/"})

        with pytest.raises(FetchTransientError, match="^fetch_dns_error"):
            fetch(handler)

    def test_redirect_chain_over_limit_fails_terminally(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(302, headers={"location": str(request.url) + "x"})

        with pytest.raises(FetchTerminalError, match="^too_many_redirects"):
            fetch(handler)

    def test_oversized_body_fails_terminally(self):
        with pytest.raises(FetchTerminalError, match="^content_too_large"):
            fetch(lambda request: html_response("x" * 2_000))

    def test_declared_oversize_fails_before_reading(self):
        response = html_response(
            "tiny", headers={"content-type": "text/html", "content-length": "999999"}
        )
        with pytest.raises(FetchTerminalError, match="^content_too_large"):
            fetch(lambda request: response)

    def test_disallowed_content_type_fails_terminally(self):
        response = httpx.Response(
            200, content=b"%PDF-", headers={"content-type": "application/pdf"}
        )
        with pytest.raises(FetchTerminalError, match="^unsupported_content_type"):
            fetch(lambda request: response)

    @pytest.mark.parametrize("status", [404, 429, 503])
    def test_http_errors_are_transient(self, status: int):
        with pytest.raises(FetchTransientError, match="^fetch_http_error"):
            fetch(lambda request: httpx.Response(status, content=b""))

    def test_timeout_is_transient(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("read timed out")

        with pytest.raises(FetchTransientError, match="^fetch_timeout"):
            fetch(handler)

    def test_connection_error_is_transient(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused")

        with pytest.raises(FetchTransientError, match="^fetch_http_error"):
            fetch(handler)

    def test_allowlisted_host_still_bounded(self):
        limits = replace(LIMITS, allowed_hosts=frozenset({"api"}))
        response = httpx.Response(
            200, content=b"%PDF-", headers={"content-type": "application/pdf"}
        )
        with pytest.raises(FetchTerminalError, match="^unsupported_content_type"):
            fetch_page(
                "http://api:3000/docs",
                limits=limits,
                resolver=never_resolves,
                transport=httpx.MockTransport(lambda request: response),
            )
