"""The v1 enrichment result contract as native pydantic models.

The contract is defined twice — here and as a Zod definition in the API
(`apps/api/src/contract.ts`). The shared fixtures in
`contracts/enrichment/fixtures/` keep the two definitions in agreement;
change one side only together with the other and the fixtures.
"""

import json
from datetime import date
from functools import lru_cache
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    TypeAdapter,
    ValidationError,
    model_validator,
)

CONTRACT_VERSION = "v1"


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


class RevisitSuggestion(_StrictModel):
    reason: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    suggested_date: date


class _ResultBase(_StrictModel):
    contract_version: Literal["v1"]
    summary: Annotated[str, StringConstraints(min_length=1, max_length=2000)]
    key_takeaway: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    topics: Annotated[
        list[Annotated[str, StringConstraints(min_length=1, max_length=100)]],
        Field(min_length=1, max_length=10),
    ]
    suggested_group: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    save_intent: Literal["reference", "read_later", "time_sensitive"]
    evidence: Annotated[list[EvidenceItem], Field(max_length=10)]


class NonRevisitResult(_ResultBase):
    recommended_action: Literal["none", "read_soon", "action"]


class RevisitResult(_ResultBase):
    recommended_action: Literal["revisit"]
    revisit: RevisitSuggestion


# The revisit invariant is structural: only the revisit variant carries the
# suggestion, and extra="forbid" rejects it everywhere else.
EnrichmentResult = Annotated[
    NonRevisitResult | RevisitResult, Field(discriminator="recommended_action")
]


# The union type has no .model_validate(); a TypeAdapter provides it, and is
# cached because constructing one compiles the union's validator.
@lru_cache(maxsize=1)
def _enrichment_result_adapter() -> TypeAdapter[Any]:
    return TypeAdapter(EnrichmentResult)


def validation_errors(result: Any) -> list[str]:
    """Return a list of human-readable contract violations; empty means valid.

    Validation runs in JSON mode so semantics match the API's Zod definition,
    which always sees JSON documents: date strings are accepted for date
    fields, but no scalar coercion (e.g. "5" to 5) happens.
    """
    payload = result.model_dump_json() if isinstance(result, BaseModel) else json.dumps(result)
    try:
        _enrichment_result_adapter().validate_json(payload)
    except ValidationError as exc:
        return [
            f"/{'/'.join(str(p) for p in error['loc'])}: {error['msg']}"
            for error in exc.errors(include_url=False)
        ]
    return []


def is_valid(result: Any) -> bool:
    return not validation_errors(result)


def parse_result(data: Any) -> NonRevisitResult | RevisitResult:
    """Parse untrusted data into a contract model, raising ValidationError.

    Runs in JSON mode (same semantics as validation_errors) so model output
    is judged exactly like any other JSON document crossing the contract.
    """
    return _enrichment_result_adapter().validate_json(json.dumps(data))


def result_json_schema() -> dict[str, Any]:
    """JSON Schema of the result union, for structured-output tool definitions."""
    return _enrichment_result_adapter().json_schema()
