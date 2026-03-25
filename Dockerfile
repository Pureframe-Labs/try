FROM oven/bun:1-alpine AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# Optional: Remove devDependencies to shrink the image
RUN rm -rf node_modules && bun install --ci --production

# Production image
FROM oven/bun:1-alpine
WORKDIR /app

# Only copy what is strictly necessary
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

# Execute the file directly
CMD ["bun", "dist/index.js"]