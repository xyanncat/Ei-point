FROM node:24.8.0-bookworm-slim AS base
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY packages/runtime/package.json ./packages/runtime/
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/api/package.json ./apps/api/
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate && pnpm install --no-frozen-lockfile --filter @ei-royality/api...
COPY . .
RUN pnpm --filter @ei-royality/api build

FROM node:24.8.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# TODO(release): switch to pnpm deploy --prod + committed pnpm-lock.yaml --frozen-lockfile once lockfile lands.
COPY --from=base /app/apps/api/dist ./dist
COPY --from=base /app/apps/api/package.json ./
COPY --from=base /app/packages/runtime/dist ../packages/runtime/dist
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate && pnpm install --prod --no-frozen-lockfile
CMD ["node", "dist/index.js"]
