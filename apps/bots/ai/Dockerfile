FROM node:24.8.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY . .
RUN --mount=type=cache,id=ei-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --store-dir=/pnpm/store && pnpm --filter @ei-point/flow build && pnpm --filter @ei-point/contracts build && pnpm --filter @ei-point/module-ai build && pnpm --filter @ei-point/module-tts build && pnpm --filter @ei-point/module-bot-ui build && pnpm --filter @ei-point/bot-ai build
RUN pnpm --filter @ei-point/bot-ai deploy --prod /release

FROM node:24.8.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /release /app
COPY --chown=node:node ["project assets/bots/Cyrene/embed.png", "/app/assets/cyrene-art.png"]
USER node
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
