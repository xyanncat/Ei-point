FROM node:24.8.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @ei-point/flow build && pnpm --filter @ei-point/workers build
RUN pnpm --filter @ei-point/workers deploy --prod /release

FROM node:24.8.0-bookworm-slim
WORKDIR /app
COPY --from=build --chown=node:node /release /app
USER node
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
