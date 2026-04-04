FROM node:22-alpine AS deps
WORKDIR /workspace
RUN npm install -g pnpm

# Copy workspace skeleton (lockfile + all package.jsons)
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
COPY cli/package.json cli/
COPY web/package.json web/
COPY infra/package.json infra/
COPY infra-v2/package.json infra-v2/

# Install only server dependencies from the locked versions
RUN pnpm install --frozen-lockfile --filter orchid-server

WORKDIR /workspace/server

FROM deps AS dev
COPY server/migrations/ migrations/
CMD ["pnpm", "exec", "tsx", "--watch", "src/index.ts"]

FROM deps AS build
COPY server/tsconfig.json ./
COPY server/src/ src/
RUN pnpm run build

FROM node:22-alpine AS prod
WORKDIR /workspace
RUN npm install -g pnpm

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
COPY cli/package.json cli/
COPY web/package.json web/
COPY infra/package.json infra/
COPY infra-v2/package.json infra-v2/

RUN pnpm install --frozen-lockfile --filter orchid-server --prod

WORKDIR /workspace/server
COPY --from=build /workspace/server/dist dist/
COPY server/migrations/ migrations/
EXPOSE 3000
CMD ["node", "dist/index.js"]
