## ADDED Requirements

### Requirement: Ollama enricher behind the existing seam
The worker SHALL provide an Ollama-backed implementation of the `Enricher` seam, selected by `ENRICHER=ollama`, that makes one chat call per enrichment to the Ollama server at `OLLAMA_BASE_URL` with the model named by `OLLAMA_MODEL`, constrains the reply to the contract schema through Ollama's structured-output format, and validates the reply strictly against the native contract before returning it. The call SHALL request a fixed context size large enough to hold the content cap together with the prompt and the reply, so that page text is never trimmed by the server. A reply that is not JSON or that fails contract validation SHALL surface as a retryable failure; a transport failure (connection error, timeout, non-success HTTP status) SHALL surface as a retryable failure. The worker SHALL refuse to start with `ENRICHER=ollama` when `OLLAMA_MODEL` is unset. The stub SHALL remain the default enricher.

#### Scenario: Ollama result is contract-validated
- **GIVEN** the Ollama enricher with a faked transport returning a contract-valid JSON reply
- **WHEN** it enriches an input
- **THEN** it returns an outcome whose result is a validated contract model instance, with `model_id` equal to the configured model and token usage taken from the reply's prompt and completion counts

#### Scenario: Request constrains output and context
- **WHEN** the Ollama enricher builds its request
- **THEN** the request targets the chat endpoint of the configured base URL, carries the contract schema as its structured-output format, a context size that holds the content cap, and the system and user messages of the shared prompt

#### Scenario: Non-JSON or invalid reply is a retryable failure
- **GIVEN** a faked transport returning either non-JSON text or JSON that violates the contract
- **WHEN** the Ollama enricher runs
- **THEN** it raises an error classified as transient with the invalid-model-output code, and nothing is persisted

#### Scenario: Transport failure is a retryable failure
- **GIVEN** a faked transport that returns a server error status or raises a connection error
- **WHEN** the Ollama enricher runs
- **THEN** it raises an error classified as transient with the enrich-error code

#### Scenario: Selection requires no code change
- **WHEN** the worker starts with `ENRICHER=ollama` and `OLLAMA_MODEL` set
- **THEN** it uses the Ollama enricher without any code change

#### Scenario: Missing model fails at startup
- **GIVEN** `ENRICHER=ollama` and `OLLAMA_MODEL` unset
- **WHEN** the worker starts
- **THEN** it fails immediately with a message naming `OLLAMA_MODEL`, before claiming any job

## MODIFIED Requirements

### Requirement: Enricher outcomes carry model metadata
Each enricher SHALL declare a stable `prompt_version` identifying its prompt/behavior generation, and outcomes SHALL carry the `model_id` plus, when the backend reports them, call latency and token usage, so the worker can persist them with the enrichment. The stub's `prompt_version` is `stub-v2`. Model-backed enrichers SHALL derive their `prompt_version` as the provider name followed by the shared prompt generation (`bedrock-v3`, `ollama-v3`), so that the same link and content enriched by different providers persist as distinct rows; the shared generation SHALL change for every provider whenever the shared prompt changes.

#### Scenario: Bedrock outcome includes usage metadata
- **GIVEN** the Bedrock enricher with a faked client reporting token usage
- **WHEN** it enriches an input
- **THEN** the outcome includes `model_id`, latency, and token usage, and the enricher exposes its `prompt_version`

#### Scenario: Ollama outcome includes usage metadata
- **GIVEN** the Ollama enricher with a faked transport reporting prompt and completion token counts
- **WHEN** it enriches an input
- **THEN** the outcome includes `model_id`, latency, and token usage, and the enricher exposes `prompt_version` `ollama-v3`

#### Scenario: Stub outcome needs no metadata backend
- **WHEN** the stub enriches an input
- **THEN** the outcome carries `model_id` `stub` and the enricher exposes `prompt_version` `stub-v2`, with latency and token usage absent

#### Scenario: Providers on the same prompt generation persist separately
- **GIVEN** a link whose content was enriched under `bedrock-v3`
- **WHEN** the same link and content are enriched under `ollama-v3`
- **THEN** a second enrichments row is stored rather than the existing one being treated as already done

### Requirement: Bedrock prompt carries decision criteria and field guidance
Model-backed enrichers SHALL share one prompt, so a prompt change applies to every provider at once. That prompt SHALL instruct the model on v2 semantics in the system prompt: prefer tags from the provided vocabulary and invent a new tag only when nothing fits, named consistently with the existing ones; assert a `deadline` only when the page ties its value to a concrete, defensible date, with `source` quoting the asserting sentence verbatim, and omit the deadline when in doubt; and note that the page text may be truncated mid-sentence. The structured-output schema SHALL carry a `description` for each of `summary`, `key_takeaway`, `tags`, `deadline`, and `evidence` stating the field's purpose and limits. The tag vocabulary is trusted user data and SHALL appear in the system prompt's instruction section, never inside the delimited untrusted page content. Page text SHALL be truncated to a fixed character cap by keeping its prefix, so evidence offsets stay valid. This guidance SHALL NOT change what the contract accepts. The Bedrock request shape and `prompt_version` SHALL remain as before the prompt became shared.

#### Scenario: System prompt contains tag and deadline discipline
- **WHEN** a model-backed enricher builds its model request
- **THEN** the system prompt states the closed-world tag preference, the defensible-date rule with verbatim source sentence, omission as the default when no date is defensible, and the truncation notice

#### Scenario: Vocabulary stays out of the untrusted block
- **GIVEN** a tag vocabulary and extracted page text
- **WHEN** a model-backed enricher builds its model request
- **THEN** the vocabulary appears in the system prompt and the page text only in the delimited untrusted-content section

#### Scenario: Both providers send the same prompt
- **GIVEN** the same enrichment input
- **WHEN** the Bedrock and Ollama enrichers build their requests
- **THEN** the system prompt text and the user message text are identical across the two

#### Scenario: Prompt generation is identifiable as bedrock-v3
- **WHEN** the Bedrock enricher produces an outcome under the v2 prompt
- **THEN** the enricher's `prompt_version` is `bedrock-v3`
