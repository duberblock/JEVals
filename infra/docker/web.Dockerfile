FROM node:22-slim AS deps
WORKDIR /app/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app/apps/web
# Standalone output: server.js plus only the node_modules the server needs
# (~90 MB runtime instead of the full 1.2 GB tree). Local dev, `npm run
# start` and serve-auth keep the classic output (no env flag).
ENV NEXT_OUTPUT_STANDALONE=1
COPY --from=deps /app/apps/web/node_modules ./node_modules
COPY apps/web ./
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
