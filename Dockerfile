# --- Stage 1: Base ---
FROM oven/bun:1.1-alpine AS base
WORKDIR /app

# --- Stage 2: Install (Fast Caching) ---
FROM base AS install
# COPY the lockfile! This makes "bun install" nearly instant if deps haven't changed.
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

# --- Stage 3: Builder ---
FROM base AS builder
COPY --from=install /app/node_modules ./node_modules
COPY . .
# Build to a single file
RUN bun build ./index.ts --outfile ./dist/index.js --target bun

# --- Stage 4: Production Runner ---
FROM oven/bun:1.1-alpine AS runner
WORKDIR /app

# Copy ONLY the compiled executable and necessary assets
COPY --from=builder /app/dist/index.js ./index.js

# Create your specific app folders
RUN mkdir -p downloads/property_card downloads/ferfar downloads/satBara

# Production Env
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Start directly from the compiled file
CMD ["bun", "run", "index.js"]