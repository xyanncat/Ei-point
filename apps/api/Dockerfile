FROM node:24.8.0-bookworm-slim AS base
# NOTE: verify on target VPS (no AVX/AES-NI per benchmark §1). Build off hot path; ship digests.
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
CMD ["node", "--version"]
