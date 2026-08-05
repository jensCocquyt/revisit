# Build context is the repo root so the shared contracts/ directory is available.
FROM node:24-alpine AS build
WORKDIR /app/apps/api
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci
COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app/apps/api
COPY contracts /app/contracts
COPY --from=build /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
