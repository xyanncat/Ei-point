FROM node:24.8.0-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24.8.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
CMD ["pnpm", "start"]
