FROM node:24.8.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @ei-point/contracts build && pnpm --filter @ei-point/flow build && pnpm --filter @ei-point/module-commerce build && pnpm --filter @ei-point/api build
RUN pnpm --filter @ei-point/api deploy --prod /release
FROM node:24.8.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /release /app
COPY --from=build --chown=node:node /app/infra/postgres /app/infra/postgres
COPY --from=build --chown=node:node /app/scripts/check-heartbeats.mjs /app/scripts/check-heartbeats.mjs
USER node
CMD ["node", "dist/index.js"]
