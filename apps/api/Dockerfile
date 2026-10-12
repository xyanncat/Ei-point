FROM node:24.8.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @ei-point/contracts build && pnpm --filter @ei-point/api build
RUN pnpm --filter @ei-point/api deploy --prod /release
FROM node:24.8.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /release /app
USER node
CMD ["node", "dist/index.js"]
