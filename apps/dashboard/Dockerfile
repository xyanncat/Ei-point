FROM node:24.8.0-bookworm-slim AS build
WORKDIR /app
# Workspace manifests must exist before frozen install (coderabbit fix).
COPY package.json pnpm-workspace.yaml ./
COPY apps/dashboard/package.json ./apps/dashboard/
# No pnpm-lock.yaml yet in Phase 2 — generate it on the VPS gate (see docs/phase-gates.md).
# Release builds use --frozen-lockfile once the lockfile is committed.
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate && pnpm install --no-frozen-lockfile --filter @ei-royality/dashboard...
COPY . .
RUN pnpm --filter @ei-royality/dashboard build

FROM node:24.8.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY --from=build /app ./
CMD ["pnpm", "start"]
