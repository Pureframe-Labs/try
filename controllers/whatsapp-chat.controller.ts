/**
 * ============================================================================
 * WHATSAPP CHAT CONTROLLER
 * ============================================================================
 * 
 * Purpose:
 * Admin-facing controller for managing the WhatsApp interface.
 * Allows checking status, broadcasting messages, and clearing sessions.
 */

import { Context } from 'hono'
import { whatsappService } from '../services/whatsapp.service'
import { sessionManager } from '../services/session-manager.service'
import { logger } from '../utils/logger'

class WhatsAppChatController {
  /**
   * Retrieves the current connection status of the WhatsApp client.
   * Includes QR code if not authenticated.
   */
  async getStatus(c: Context) {
    const status = whatsappService.getStatus()
    return c.json({
      success: true,
      ...status,
      timestamp: new Date().toISOString()
    })
  }

  /**
   * Send test message (admin only)
   */
  async sendTestMessage(c: Context) {
    try {
      const { phone, message } = await c.req.json()

      if (!phone || !message) {
        return c.json({ error: 'Phone and message required' }, 400)
      }

      const success = await whatsappService.sendMessage(phone, message)

      return c.json({
        success,
        message: success ? 'Message sent' : 'Failed to send message'
      })

    } catch (error) {
      logger.error('Error sending test message:', error)
      return c.json({ error: 'Internal server error' }, 500)
    }
  }

  /**
   * Broadcasts a text message to ALL registered users.
   * WARNING: Use with caution to avoid being flagged as spam.
   * 
   * @param c Hono Context (body: message)
   */
  async broadcastMessage(c: Context) {
    try {
      const { message } = await c.req.json()

      if (!message) {
        return c.json({ error: 'Message required' }, 400)
      }

      // Get all users from database
      const users = await this.getAllUsers()
      const results = []

      for (const user of users) {
        const success = await whatsappService.sendMessage(user.phoneNumber, message)
        results.push({
          phone: user.phoneNumber,
          success,
          timestamp: new Date().toISOString()
        })
      }

      return c.json({
        success: true,
        total: results.length,
        sent: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      })

    } catch (error) {
      logger.error('Error broadcasting message:', error)
      return c.json({ error: 'Internal server error' }, 500)
    }
  }

  /**
   * Get all sessions
   */
  async getSessions(c: Context) {
    try {
      const sessions = await this.getAllSessions()

      return c.json({
        success: true,
        count: sessions.length,
        sessions
      })

    } catch (error) {
      logger.error('Error getting sessions:', error)
      return c.json({ error: 'Internal server error' }, 500)
    }
  }

  /**
   * Forcefully clears the session for a specific user.
   * Useful for resetting stuck conversational states.
   * 
   * @param c Hono Context (body: phone)
   */
  async clearSession(c: Context) {
    try {
      const { phone } = await c.req.json()

      if (!phone) {
        return c.json({ error: 'Phone number required' }, 400)
      }

      await sessionManager.clearSession(phone)

      return c.json({
        success: true,
        message: `Session cleared for ${phone}`
      })

    } catch (error) {
      logger.error('Error clearing session:', error)
      return c.json({ error: 'Internal server error' }, 500)
    }
  }

  /**
   * Helper: Get all users
   */
  private async getAllUsers(): Promise<Array<{ phoneNumber: string }>> {
    // Implement based on your database schema
    // This is a placeholder
    return []
  }

  /**
   * Helper: Get all sessions
   */
  private async getAllSessions(): Promise<any[]> {
    // Implement based on your database schema
    // This is a placeholder
    return []
  }
}

export const whatsappChatController = new WhatsAppChatController()