FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Run this target as a separate Cloud Run Job before deploying a schema change.
FROM build AS migrate
CMD ["npm", "run", "prisma:deploy"]

FROM build AS production-dependencies
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=8080 REMINDERS_ENABLED=false
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
RUN mkdir uploads uploads-private && chown node:node uploads uploads-private
USER node
EXPOSE 8080
CMD ["node", "dist/src/server.js"]
