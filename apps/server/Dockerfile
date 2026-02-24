FROM node:22-bookworm-slim

WORKDIR /workspace

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm run cloudrun:build:server

ENV NODE_ENV=production

CMD ["node", "apps/server/dist/index.js"]
