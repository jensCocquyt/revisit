#!/usr/bin/env bash
# Builds and pushes the three service images, tagged with the current commit.
# Needs REGISTRY and GITHUB_SHA; run from the repository root.
set -euo pipefail

for image in api worker migrate; do
  case "$image" in
    api)     dockerfile=apps/api/Dockerfile ;;
    worker)  dockerfile=apps/worker/Dockerfile ;;
    migrate) dockerfile=db/Dockerfile ;;
  esac
  docker build -f "$dockerfile" -t "$REGISTRY/revisit/$image:$GITHUB_SHA" .
  docker push "$REGISTRY/revisit/$image:$GITHUB_SHA"
done
