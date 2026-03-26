# --- Stage 1: Base ---
FROM oven/bun:1.1-alpine AS base
WORKDIR /app

# --- Stage 2: Dependencies ---
FROM base AS install
# Only copy package.json to avoid the lockfile version error
COPY package.json ./
RUN bun install --production

# --- Stage 3: Builder ---
FROM base AS builder
# Copy the node_modules from the previous stage
COPY --from=install /app/node_modules ./node_modules
# Copy all source files
COPY . .

# Build the app. Target 'bun' ensures it uses Bun's high-speed runtime.
# We explicitly point to index.ts
RUN bun build ./index.ts --outdir ./dist --target bun

# --- Stage 4: Production Runner ---
FROM oven/bun:1.1-alpine AS runner
WORKDIR /app

# Only copy the final bundle and package info
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json .

# Create the folders your Hono app expects for downloads
RUN mkdir -p downloads/property_card downloads/ferfar downloads/satBara

# Ensure Railway uses the correct Port and Production optimizations
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Start the app using the bundled file
CMD ["bun", "dist/index.js"]