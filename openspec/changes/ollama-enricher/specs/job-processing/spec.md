## MODIFIED Requirements

### Requirement: Processing configuration via environment
Poll interval, lease duration, maximum attempts, fetch limits (redirects, size, duration, content types, host allowlist), enricher selection, and the selected provider's settings (Bedrock: model ID and region; Ollama: server base URL and model) SHALL be configurable via environment variables with working defaults documented in `.env.example` and wired through Docker Compose. Defaults SHALL keep the stub as the enricher and let the local stack enrich a saved link without any configuration edits or cloud credentials. In Docker Compose the Ollama base URL SHALL default to the host machine, where Ollama runs, and the worker container SHALL be able to resolve that host name.

#### Scenario: Defaults work out of the box
- **WHEN** the stack starts from an unedited `.env.example`
- **THEN** the worker polls, claims, fetches, and completes jobs using the default configuration with the stub enricher and no AWS credentials

#### Scenario: Bedrock is opt-in via environment only
- **WHEN** `ENRICHER=bedrock` and AWS settings are provided via environment
- **THEN** the worker uses the Bedrock enricher without any code change

#### Scenario: Ollama is opt-in via environment only
- **WHEN** `ENRICHER=ollama` and `OLLAMA_MODEL` are provided via environment, with Ollama running on the host
- **THEN** the worker container reaches the host's Ollama server at the default base URL and enriches a saved link without any code change
