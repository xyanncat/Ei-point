FROM node:24.8.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @ei-point/flow build && pnpm --filter @ei-point/contracts build && pnpm --filter @ei-point/module-security build && pnpm --filter @ei-point/module-moderation build && pnpm --filter @ei-point/module-logging build && pnpm --filter @ei-point/bot-security build && pnpm --filter @ei-point/bot-moderation build && pnpm --filter @ei-point/module-bot-ui build && pnpm --filter @ei-point/bot-kafka build
RUN pnpm --filter @ei-point/bot-kafka deploy --prod /release

FROM node:24.8.0-bookworm-slim
WORKDIR /app
COPY --from=build --chown=node:node /release /app
USER node
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
