# One-off migration image for the cloud: dbmate plus the committed migration
# files, mirroring the compose migrate service (which mounts ./db instead).
# Built from the repository root: docker build -f db/Dockerfile .
FROM ghcr.io/amacneil/dbmate:2

COPY db/migrations /db/migrations

CMD ["--no-dump-schema", "up"]
