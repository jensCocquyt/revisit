"""The v2 enrichment result contract as native pydantic models.

The contract is defined twice — here and as a Zod definition in the API
(`apps/api/src/contract.ts`). The shared fixtures in
`contracts/enrichment/fixtures/` keep the two definitions in agreement;
change one side only together with the other and the fixtures.

v2 is flat: tags (closed-world assigned labels) and an optional, complete
`deadline` whose `source` quotes the page sentence asserting the date. The
v1 enums and the revisit discriminated union are gone.
"""

import json
from datetime import date
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    model_validator,
)

CONTRACT_VERSION = "v2"

TAG_MAX_LENGTH = 50
TAGS_MAX_COUNT = 5


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class EvidenceItem(_StrictModel):
    quote: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    start_offset: Annotated[int, Field(ge=0)]
    end_offset: Annotated[int, Field(ge=0)]

    @model_validator(mode="after")
    def _offsets_ordered(self) -> "EvidenceItem":
        if self.end_offset < self.start_offset:
            raise ValueError("end_offset must be >= start_offset")
        return self


class Deadline(_StrictModel):
    """A defensible date the page ties its value to. Complete or absent:
    `source` quotes the sentence in the page text asserting the date."""

    date: date
    reason: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    source: EvidenceItem


class EnrichmentResult(_StrictModel):
    contract_version: Literal["v2"]
    summary: Annotated[str, StringConstraints(min_length=1, max_length=2000)]
    key_takeaway: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    tags: Annotated[
        list[Annotated[str, StringConstraints(min_length=1, max_length=TAG_MAX_LENGTH)]],
        Field(min_length=1, max_length=TAGS_MAX_COUNT),
    ]
    deadline: Deadline | None = None
    evidence: Annotated[list[EvidenceItem], Field(max_length=10)]

    @model_validator(mode="after")
    def _tags_normalized_and_unique(self) -> "EnrichmentResult":
        for tag in self.tags:
            if tag != tag.strip():
                raise ValueError(f"tag {tag!r} has leading or trailing whitespace")
            if tag != tag.lower():
                raise ValueError(f"tag {tag!r} must be lowercase")
        if len(set(self.tags)) != len(self.tags):
            raise ValueError("tags must be unique")
        return self


def validation_errors(result: Any) -> list[str]:
    """Return a list of human-readable contract violations; empty means valid.

    Validation runs in JSON mode so semantics match the API's Zod definition,
    which always sees JSON documents: date strings are accepted for date
    fields, but no scalar coercion (e.g. "5" to 5) happens.
    """
    payload = result.model_dump_json() if isinstance(result, BaseModel) else json.dumps(result)
    try:
        EnrichmentResult.model_validate_json(payload)
    except ValidationError as exc:
        return [
            f"/{'/'.join(str(p) for p in error['loc'])}: {error['msg']}"
            for error in exc.errors(include_url=False)
        ]
    return []


def is_valid(result: Any) -> bool:
    return not validation_errors(result)


def parse_result(data: Any) -> EnrichmentResult:
    """Parse untrusted data into a contract model, raising ValidationError.

    Runs in JSON mode (same semantics as validation_errors) so model output
    is judged exactly like any other JSON document crossing the contract.
    """
    return EnrichmentResult.model_validate_json(json.dumps(data))
