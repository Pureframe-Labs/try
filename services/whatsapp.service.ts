import { logger } from '../utils/logger'
import fs from 'fs/promises'
import path from 'path'

// ─── Build shared headers ONCE at module load ─────────────────────────────────
// Avoids rebuilding the same object on every single API call.

function buildHeaders(): Record<string, string> {
  const apiKey = process.env.API_KEY || process.env.WHATSAPP_ACCESS_TOKEN || ''
  return {
    'Content-Type': 'application/json',
    'api-key': apiKey,
  }
}

function buildBearerHeaders(): Record<string, string> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || ''
  return { Authorization: `Bearer ${token}` }
}

// Lazily initialised so env is guaranteed to be loaded
let _headers: Record<string, string> | null = null
let _bearerHeaders: Record<string, string> | null = null

function getHeaders(): Record<string, string> {
  if (!_headers) _headers = buildHeaders()
  return _headers
}

function getBearerHeaders(): Record<string, string> {
  if (!_bearerHeaders) _bearerHeaders = buildBearerHeaders()
  return _bearerHeaders
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(to: string): string {
  return to.replace('@c.us', '')
}

function getApiUrl(): string {
  const base = process.env.BASE_URL || 'https://graph.facebook.com/v21.0'
  const phoneId = process.env.PHONE_NUMBER_ID || ''
  return `${base}/${phoneId}/messages`
}

// ─── WhatsAppService ──────────────────────────────────────────────────────────

class WhatsAppService {

  getStatus() {
    return { isReady: true, qrCode: null, initializationInProgress: false }
  }

  // ── Text message ────────────────────────────────────────────────────────────

  async sendMessage(to: string, text: string): Promise<boolean> {
    const normalizedTo = normalize(to)
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizedTo,
      type: 'text',
      text: { body: text },
    }

    try {
      const response = await fetch(getApiUrl(), {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => response.statusText)
        throw new Error(`WhatsApp API ${response.status}: ${err}`)
      }

      logger.info(`📤 Text → ${normalizedTo} | "${text.substring(0, 50)}${text.length > 50 ? '…' : ''}"`)
      return true
    } catch (error: any) {
      logger.error(`❌ sendMessage to ${normalizedTo}:`, error.message)
      return false
    }
  }

  // ── Interactive list ────────────────────────────────────────────────────────

  async sendListMessage(
    to: string,
    body: string,
    buttonText: string,
    sections: any[],
    header?: string,
    footer?: string
  ): Promise<boolean> {
    const normalizedTo = normalize(to)
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizedTo,
      type: 'interactive',
      interactive: {
        type: 'list',
        ...(header ? { header: { type: 'text', text: header } } : {}),
        body: { text: body },
        ...(footer ? { footer: { text: footer } } : {}),
        action: { button: buttonText, sections },
      },
    }

    try {
      const response = await fetch(getApiUrl(), {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => response.statusText)
        throw new Error(`WhatsApp List API ${response.status}: ${err}`)
      }

      logger.info(`📤 List → ${normalizedTo} | "${buttonText}"`)
      return true
    } catch (error: any) {
      logger.error(`❌ sendListMessage to ${normalizedTo}:`, error.message)
      return false
    }
  }

  // ── Reply buttons ───────────────────────────────────────────────────────────

  async sendReplyButtons(
    to: string,
    body: string,
    buttons: { id: string; title: string }[],
    header?: string,
    footer?: string
  ): Promise<boolean> {
    const normalizedTo = normalize(to)
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizedTo,
      type: 'interactive',
      interactive: {
        type: 'button',
        ...(header ? { header: { type: 'text', text: header } } : {}),
        body: { text: body },
        ...(footer ? { footer: { text: footer } } : {}),
        action: {
          buttons: buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
        },
      },
    }

    try {
      const response = await fetch(getApiUrl(), {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => response.statusText)
        throw new Error(`WhatsApp Buttons API ${response.status}: ${err}`)
      }

      logger.info(`📤 Buttons (${buttons.length}) → ${normalizedTo}`)
      return true
    } catch (error: any) {
      logger.error(`❌ sendReplyButtons to ${normalizedTo}:`, error.message)
      return false
    }
  }

  // ── Payment link (CTA URL) ──────────────────────────────────────────────────

  async sendPaymentLink(to: string, orderId: string, amount: number, serviceName: string): Promise<boolean> {
    const normalizedTo   = normalize(to)
    const publicUrl      = process.env.NGROK_BASE_URL || process.env.BACKEND_URL || 'http://localhost:3000'
    const paymentUrl     = `${publicUrl}/payment/checkout?orderId=${orderId}`
    const amountInRupees = Number(amount) || 0

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizedTo,
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        header: { type: 'text', text: 'Secure Payment' },
        body: {
          text: `💳 *Payment Required*\n📄 ${serviceName}\n💰 ₹${amountInRupees.toFixed(2)}\n🆔 ${orderId}\n\n⏳ Please complete within 10 mins. PDF is delivered automatically after payment.`,
        },
        action: {
          name: 'cta_url',
          parameters: { display_text: ' Pay Now', url: paymentUrl },
        },
      },
    }

    try {
      const response = await fetch(getApiUrl(), {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        logger.error(`❌ sendPaymentLink (${response.status}):`, JSON.stringify(errorData))
        // Fallback to plain text link
        return this.sendMessage(to, `💳 *Payment Link:*\n${paymentUrl}\n\n📄 Service: ${serviceName}\n💰 Amount: ₹${amountInRupees}`)
      }

      logger.info(`📤 Payment link → ${normalizedTo}`)
      return true
    } catch (error: any) {
      logger.error(`❌ sendPaymentLink to ${normalizedTo}:`, error.message)
      return this.sendMessage(to, `💳 *Payment Link:*\n${paymentUrl}`)
    }
  }

  // ── Image ───────────────────────────────────────────────────────────────────

  async sendImage(to: string, imageUrl: string, caption?: string): Promise<boolean> {
    const normalizedTo = normalize(to)
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizedTo,
      type: 'image',
      image: { link: imageUrl, caption: caption || '' },
    }

    try {
      const response = await fetch(getApiUrl(), {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error(`WhatsApp Image API ${response.status}`)
      logger.info(`📤 Image → ${normalizedTo}`)
      return true
    } catch (error: any) {
      logger.error(`❌ sendImage to ${normalizedTo}:`, error.message)
      return false
    }
  }

  // ── Document ────────────────────────────────────────────────────────────────

  async sendDocument(to: string, filePath: string, filename: string, caption?: string): Promise<boolean> {
    const normalizedTo = normalize(to)
    const ngrokBase    = process.env.NGROK_BASE_URL || process.env.BASE_URL || 'http://localhost:3000'

    let docUrl: string
    if      (filePath.includes('satBara'))      docUrl = `${ngrokBase}/files/satBara/${filename}`
    else if (filePath.includes('8a'))           docUrl = `${ngrokBase}/files/8a/${filename}`
    else if (filePath.includes('ferFar'))       docUrl = `${ngrokBase}/files/ferFar/${filename}`
    else if (filePath.includes('propertyCard')) docUrl = `${ngrokBase}/files/propertyCard/${filename}`
    else                                        docUrl = `${ngrokBase}/files/docs/${filename}`

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizedTo,
      type: 'document',
      document: { link: docUrl, filename, caption: caption || '' },
    }

    try {
      const response = await fetch(getApiUrl(), {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error(`WhatsApp Document API ${response.status} ${response.statusText}`)
      logger.info(`📤 Document "${filename}" → ${normalizedTo}`)
      return true
    } catch (error: any) {
      logger.error(`❌ sendDocument to ${normalizedTo}:`, error.message)
      return false
    }
  }

  // ── Media helpers ───────────────────────────────────────────────────────────

  async getMediaUrl(mediaId: string): Promise<string | null> {
    const url = `https://graph.facebook.com/v21.0/${mediaId}`
    try {
      const response = await fetch(url, { headers: getBearerHeaders() })
      if (!response.ok) {
        const err = await response.text().catch(() => response.statusText)
        throw new Error(`Media API ${response.status}: ${err}`)
      }
      const data = await response.json() as { url: string }
      return data.url
    } catch (error: any) {
      logger.error(`❌ getMediaUrl ${mediaId}:`, error.message)
      return null
    }
  }

  /**
   * Download media binary and write to `savePath`.
   * `fs` and `path` are top-level imports — no dynamic import overhead.
   */
  async downloadMedia(mediaId: string, savePath: string): Promise<boolean> {
    const downloadUrl = await this.getMediaUrl(mediaId)
    if (!downloadUrl) return false

    try {
      const response = await fetch(downloadUrl, { headers: getBearerHeaders() })
      if (!response.ok) throw new Error(`Media Download ${response.status} ${response.statusText}`)

      const buffer = await response.arrayBuffer()
      await fs.mkdir(path.dirname(savePath), { recursive: true })
      await fs.writeFile(savePath, Buffer.from(buffer))
      return true
    } catch (error: any) {
      logger.error(`❌ downloadMedia ${mediaId}:`, error.message)
      return false
    }
  }
}

export const whatsappService = new WhatsAppService()
