import fs from 'fs'
import path from 'path'

/**
 * ============================================================================
 * LOGGER UTILITY
 * ============================================================================
 * Basic logging utility with different log levels
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

class Logger {
  private logLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info'

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
    const currentIndex = levels.indexOf(this.logLevel)
    const messageIndex = levels.indexOf(level)
    return messageIndex >= currentIndex
  }

  debug(message: string, ...args: any[]) {
    if (this.shouldLog('debug')) {
      console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`, ...args)
    }
  }

  info(message: string, ...args: any[]) {
    if (this.shouldLog('info')) {
      console.log(`[INFO] ${new Date().toISOString()} - ${message}`, ...args)
    }
  }

  warn(message: string, ...args: any[]) {
    if (this.shouldLog('warn')) {
      console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, ...args)
    }
  }

  error(message: string, ...args: any[]) {
    if (this.shouldLog('error')) {
      console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, ...args)
    }
  }
}

export const logger = new Logger()
export default logger