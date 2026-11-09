FROM node:24.8.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY . .
RUN --mount=type=cache,id=ei-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --store-dir=/pnpm/store && pnpm --filter @ei-point/contracts build && pnpm --filter @ei-point/flow build && pnpm --filter @ei-point/module-commerce build && pnpm --filter @ei-point/api build && pnpm --filter @ei-point/workers build
RUN pnpm --filter @ei-point/api deploy --prod /release
# Render runs the API and the job worker in one free service (one always-on
# service per workspace); the combined start script launches both processes.
RUN pnpm --filter @ei-point/workers deploy --prod /release-workers
FROM node:24.8.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /release /app
COPY --from=build --chown=node:node /release-workers /app/workers
COPY --chown=node:node infra/render/start-api.sh /app/start-api.sh
COPY --from=build --chown=node:node /app/infra/postgres /app/infra/postgres
COPY --from=build --chown=node:node /app/scripts/check-heartbeats.mjs /app/scripts/check-heartbeats.mjs
USER node
CMD ["node", "dist/index.js"]
