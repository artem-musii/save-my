FROM oven/bun:1.3.10-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN bun run build

FROM oven/bun:1.3.10-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    RUN_DB_MIGRATIONS=true \
    DB_MIGRATION_MAX_ATTEMPTS=30

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --from=build --chown=bun:bun /app/src ./src
COPY --chown=bun:bun scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh

# Test sources are useful in the build stage but unnecessary in production.
RUN find src -type f -name '*.test.ts' -delete

USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD bun -e "const response=await fetch('http://127.0.0.1:3000/api/health'); if(!response.ok) process.exit(1)"
ENTRYPOINT ["sh", "/app/scripts/docker-entrypoint.sh"]
CMD ["bun", "src/server/index.ts"]
