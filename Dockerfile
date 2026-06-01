FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV CI=true

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY lib ./lib
COPY artifacts ./artifacts
COPY scripts ./scripts
COPY README.md ./
COPY .env.example ./

RUN pnpm install --no-frozen-lockfile
RUN pnpm build

EXPOSE 8080

CMD ["pnpm", "start"]
