# pyFides: AP2-Compliant Omnichannel Escrow Agent for Machine-to-Machine (A2A) Commerce
# Multi-stage Dockerfile for production deployment

FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json tsconfig.json ./

# Install dependencies (ignoring scripts for build safety)
RUN npm ci --ignore-scripts || npm install

# Copy source code and UI assets
COPY src ./src
COPY tests ./tests

# Build TypeScript to dist
RUN npm run build

# Production runtime stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy runtime assets and built output
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY src/ui/public ./src/ui/public
COPY LICENSE README.md PRD.md ./

# Non-root user for security (OWASP defense)
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "dist/server.js"]
