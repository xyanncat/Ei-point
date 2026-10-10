FROM node:24.8.0-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
CMD ["node", "--version"]
