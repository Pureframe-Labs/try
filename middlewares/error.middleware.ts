/**
 * ============================================================================
 * ERROR HANDLING MIDDLEWARE
 * ============================================================================
 * Centralized error handling for the application
 */

import type { Context, Next } from 'hono'

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational = true
  ) {
    super(message)
    Object.setPrototypeOf(this, AppError.prototype)
  }
}

/**
 * Error handling middleware
 */
export async function errorHandler(err: Error, c: Context) {
    console.log("============================================================");
    console.log("============================================================");
    console.error('Error occurred:', err)
    console.log("============================================================");
    console.log("============================================================");

  // Handle AppError instances
  if (err instanceof AppError) {
    return c.json(
      {
        error: err.message,
        status: err.statusCode,
      },
      err.statusCode as any
    )
  }

  // Handle generic errors
  const isDevelopment = process.env.NODE_ENV === 'development'

  return c.json(
    {
      error: 'Internal Server Error',
      message: err.message,
      ...(isDevelopment && { stack: err.stack }),
    },
    500
  )
}

/**
 * Async error wrapper
 */
export function catchAsync(fn: Function) {
  return async (c: Context, next: Next) => {
    try {
      await fn(c, next)
    } catch (error) {
      await errorHandler(error as Error, c)
    }
  }
}