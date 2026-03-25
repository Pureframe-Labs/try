/**
 * ============================================================================
 * AUTHENTICATION MIDDLEWARE
 * ============================================================================
 * Basic authentication for protected routes
 */

import type { Context, Next } from 'hono'

/**
 * Simple API key authentication
 * Usage: Add this middleware to routes that need protection
 */
export async function apiKeyAuth(c: Context, next: Next) {
  const apiKey = c.req.header('X-API-Key')
  const validApiKey = process.env.API_KEY

  // Skip auth if API_KEY is not configured
  if (!validApiKey) {
    console.log("============================================================");
    console.log("============================================================");
    console.warn('⚠️  API_KEY not configured - authentication disabled')
    console.log("============================================================");
    console.log("============================================================");
    await next()
    return
  }

  if (!apiKey || apiKey !== validApiKey) {
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Valid API key required',
      },
      401
    )
  }

  await next()
}

/**
 * Webhook signature verification for WhatsApp
 */
export async function webhookAuth(c: Context, next: Next) {
  // This would implement WhatsApp webhook signature verification
  // For now, just pass through
  await next()
}