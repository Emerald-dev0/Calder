# Calder worker image. One long-lived process: queue -> transport -> provider.
# Needs DATABASE_URL + REDIS_URL at runtime (AWS keys optional, Mock otherwise).
FROM node:22-slim AS base
# pnpm pinned via packageManager field; corepack enable activates without extra network fetch.
RUN corepack enable
WORKDIR /app

# pnpm workspaces resolve from the repo graph, so the full context ships.
# Keep .dockerignore tight (node_modules, .next, .git) to keep builds fast.
COPY . .
RUN pnpm install --frozen-lockfile
# workspace packages have build=--noEmit (typecheck only); emit real dist for runtime
RUN for d in packages/*; do if [ -f "$d/tsconfig.json" ]; then echo "emit $d"; pnpm exec tsc --project "$d/tsconfig.json" --outDir "$d/dist" --noEmit false --module ESNext --moduleResolution Bundler --target ES2022 --declaration false --declarationMap false || true; fi; done
RUN pnpm --filter @calder/worker build

ENV NODE_ENV=production
# Health endpoint lives on :3003 in the worker; expose for host checks.
EXPOSE 3003
# Packages are src-imported (moduleResolution Bundler); run via tsx for ESM without .js extensions.
CMD ["pnpm", "--filter", "@calder/worker", "exec", "tsx", "src/index.ts"]
