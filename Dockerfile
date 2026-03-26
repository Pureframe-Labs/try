# --- Stage 1: Base ---
FROM oven/bun:1.1-alpine AS base
WORKDIR /app

# --- Stage 2: Dependencies ---
FROM base AS install
# CRITICAL FIX: Do NOT copy bun.lock or bun.lockb here.
# This prevents the 'Unknown lockfile version' error.
COPY package.json ./

# Bun will now generate its own fresh lockfile that it actually understands.
RUN bun install --production

# --- Stage 3: Builder ---
FROM base AS builder
COPY --from=install /app/node_modules ./node_modules
COPY . .

# We use index.tsx as per your previous code snippet
RUN bun build ./index.tsx --outdir ./dist --target bun

# --- Stage 4: Production Runner ---
FROM oven/bun:1.1-alpine AS runner
WORKDIR /app

COPY --from=builder /app/dist ./dist
# Re-add package.json just in case Hono needs it for metadata
COPY --from=builder /app/package.json .

# Setup directories
RUN mkdir -p downloads/property_card downloads/ferfar downloads/satBara

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["bun", "dist/index.js"]