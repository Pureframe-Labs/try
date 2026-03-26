# --- Stage 1: Base ---
FROM oven/bun:1.1-alpine AS base
WORKDIR /app

# --- Stage 2: Dependencies ---
FROM base AS install
# This syntax [file] [dest] ensures it doesn't crash if bun.lockb is missing
COPY package.json bun.lockb* ./
# Install production dependencies only
RUN bun install --production

# --- Stage 3: Builder ---
FROM base AS builder
COPY --from=install /app/node_modules ./node_modules
COPY . .
# Build the app to a single efficient file
RUN bun build ./index.ts --outfile ./dist/index.js --target bun

# --- Stage 4: Production Runner ---
FROM oven/bun:1.1-alpine AS runner
WORKDIR /app

# Only copy the tiny bundled file from the builder
COPY --from=builder /app/dist/index.js ./index.js

# Create folders for your Hono app's downloads
RUN mkdir -p downloads/property_card downloads/ferfar downloads/satBara

# Production Optimizations
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Start directly with Bun
CMD ["bun", "run", "index.js"]