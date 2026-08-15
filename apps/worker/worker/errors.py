"""The worker's failure taxonomy: terminal errors fail the job and link
immediately; transient errors retry with bounded backoff. Every error carries a
stable code that becomes the `last_error` prefix on the job.
"""


class FetchTerminalError(Exception):
    """Retrying cannot fix this; the job and link fail immediately.

    Codes: invalid_url, blocked_url, too_many_redirects,
    unsupported_content_type, content_too_large, empty_content.
    """

    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(f"{code}: {detail}")


class FetchTransientError(Exception):
    """Retryable per the bounded-backoff policy.

    Codes: fetch_dns_error, fetch_timeout, fetch_http_error.
    """

    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(f"{code}: {detail}")


class EnricherError(Exception):
    """Enrichment failure with a stable code; retryable per the backoff policy.

    Codes: invalid_model_output (response failed contract validation or carried
    no structured output), enrich_error (model call or SDK failure).
    """

    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(f"{code}: {detail}")
