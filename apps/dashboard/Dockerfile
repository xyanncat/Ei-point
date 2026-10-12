FROM node:24.8.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY . .
ENV NEXT_STANDALONE=true
ENV API_INTERNAL_URL=http://api:3001
RUN pnpm install --frozen-lockfile && pnpm --filter @ei-point/contracts build && pnpm --filter @ei-point/dashboard build
FROM node:24.8.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/dashboard/.next-production/standalone ./
COPY --from=build --chown=node:node /app/apps/dashboard/.next-production/static ./apps/dashboard/.next-production/static
COPY --from=build --chown=node:node /app/apps/dashboard/public ./apps/dashboard/public
USER node
CMD ["node", "apps/dashboard/server.js"]
