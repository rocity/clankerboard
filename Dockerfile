# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# The server is bundled into one file, so the runtime image carries no node_modules.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_DIR=/app/web \
    MIGRATIONS_DIR=/app/drizzle
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/web/dist ./web
COPY --from=build /app/packages/db/drizzle ./drizzle
USER node
EXPOSE 3000
# main.js applies migrations before it starts listening.
CMD ["node", "--enable-source-maps", "dist/main.js"]
