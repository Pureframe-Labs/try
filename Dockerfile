# --- Stage 1: Base ---
# Using 1.1-alpine to match your previous logs
FROM oven/bun:1.1-alpine AS base
WORKDIR /app

# --- Stage 2: Dependencies ---
FROM base AS install
# Copy only package files to cache this layer
COPY package.json bun.lockb* bun.lock* ./

# We remove --frozen-lockfile to prevent the "Unknown lockfile version" error 
# and ensure the container builds its own compatible dependency tree.
RUN bun install --production

# --- Stage 3: Builder ---
FROM base AS builder
# Copy node_modules from the install stage
COPY --from=install /app/node_modules ./node_modules
COPY . .

# Bundle the Hono app into a single file. 
# This makes the final image much smaller and faster to boot.
# Ensure your entry point is 'index.ts' (or 'index.tsx')
RUN bun build ./index.tsx --outdir ./dist --target bun

# --- Stage 4: Production Runner ---
FROM oven/bun:1.1-alpine AS runner
WORKDIR /app

# Only copy the compiled bundle and the public assets if you have them
COPY --from=builder /app/dist ./dist
# If you have a public folder for static assets, uncomment the next line:
# COPY --from=builder /app/public ./public

# Copy downloads folder structure (or rely on the mkdirSync in your index.ts)
RUN mkdir -p downloads/property_card downloads/ferfar downloads/satBara

# Environment Variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose the port Railway expects
EXPOSE 8080

# Run the bundled file directly. 
# This is faster than 'bun run' as it skips package.json parsing.
CMD ["bun", "dist/index.js"]