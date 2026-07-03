# Build the frontend
FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Runtime: server + built frontend
FROM node:22-alpine
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=web-build /app/web/dist ../web/dist

EXPOSE 3000
CMD ["node", "src/index.js"]
