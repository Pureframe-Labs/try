# Use a specific version for consistency
FROM oven/bun:1.1-alpine AS base
WORKDIR /app

# --- Step 1: Dependencies ---
# Only copy files needed for install to cache this layer
FROM base AS install
COPY package.json bun.lockb* bun.lock ./
RUN bun install --frozen-lockfile --production

# --- Step 2: Builder ---
FROM base AS builder
COPY --from=install /app/node_modules ./node_modules
COPY . .
# Use Bun's fast bundler to create a single-file output
RUN bun build ./src/index.ts --outdir ./dist --target bun

# --- Step 3: Runner ---
FROM oven/bun:1.1-alpine AS runner
WORKDIR /app

# Copy ONLY the bundled code (this makes the image tiny)
COPY --from=builder /app/dist ./dist
# If your app needs certain static assets, copy them here
# COPY --from=builder /app/public ./public

# Optimization: Run in production mode
ENV NODE_ENV=production
# Force Bun to use a specific port that matches Railway
ENV PORT=8080

EXPOSE 8080

# Use 'node' or 'bun' to run the single bundled file
# This is faster than 'bun run' because it skips package.json lookup
CMD ["bun", "dist/index.js"]