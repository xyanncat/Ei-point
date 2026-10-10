FROM node:24.8.0-bookworm-slim AS base
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY packages/runtime/package.json ./packages/runtime/
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/bots/security/package.json ./apps/bots/security/
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate && pnpm install --no-frozen-lockfile --filter @ei-royality/bot-security...
COPY . .
RUN pnpm --filter @ei-royality/bot-security build

FROM node:24.8.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# TODO(release): switch to pnpm deploy --prod + committed pnpm-lock.yaml --frozen-lockfile once lockfile lands.
COPY --from=base /app/apps/bots/security/dist ./dist
COPY --from=base /app/apps/bots/security/package.json ./
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate && pnpm install --prod --no-frozen-lockfile
CMD ["node", "dist/index.js"]
