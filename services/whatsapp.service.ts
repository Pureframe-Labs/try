import { logger } from '../utils/logger'

class WhatsAppService {
  private baseUrl = process.env.BASE_URL || 'https://graph.facebook.com/v21.0'
  private phoneNumberId = process.env.PHONE_NUMBER_ID || ''
  private apiKey = process.env.API_KEY || process.env.WHATSAPP_ACCESS_TOKEN || ''

  getStatus() {
    return {
      isReady: true,
      qrCode: null,
      initializationInProgress: false
    }
  }

  /**
   * Send WhatsApp text message using 2Factor API
   */
  async sendMessage(to: string, text: string): Promise<boolean> {
    const url = `${this.baseUrl}/${this.phoneNumberId}/messages`

    // Normalize phone number (remove @c.us if passed)
    const normalizedTo = to.replace('@c.us', '')

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedTo,
      type: "text",
      text: { body: text }
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey
        },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        throw new Error(`WhatsApp API Error: ${response.status} ${response.statusText}`)
      }

      logger.info(`📤 Outgoing Info: Text sent to ${normalizedTo} | Content: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`)
      return true
    } catch (error: any) {
      logger.error(`❌ Critical error sending message to ${to}:`, error.message)
      return false
    }
  }

  /**
   * Send payment link as interactive button using 2Factor API
   */
  async sendPaymentLink(
    to: string,
    orderId: string,
    amount: number,
    serviceName: string
  ): Promise<boolean> {
    const publicUrl = process.env.NGROK_BASE_URL || process.env.BACKEND_URL || 'http://localhost:3000';
    const paymentUrl = `${publicUrl}/payment/checkout?orderId=${orderId}`;
    const amountInRupees = Number(amount) || 0;
    const url = `${this.baseUrl}/${this.phoneNumberId}/messages`;
    const normalizedTo = to.replace('@c.us', '');

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedTo,
      type: "interactive",
      interactive: {
        type: "cta_url",
        header: {
          type: "text",
          text: "Secure Payment"
        },
        body: {
          text: `💳 *Payment Required*\n📄 ${serviceName}\n💰 ₹${amountInRupees.toFixed(2)}\n🆔 ${orderId}\n\n⏳ Please complete within 10 mins. PDF is delivered automatically after payment.`
        },
        action: {
          name: "cta_url",
          parameters: {
            display_text: " Pay Now",
            url: paymentUrl
          }
        }
      }
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        logger.error(`❌ WhatsApp API Error (${response.status}):`, JSON.stringify(errorData));

        // Fallback: If interactive fails, send a plain text link
        return await this.sendMessage(to, `💳 *Payment Link:*\n${paymentUrl}\n\n📄 Service: ${serviceName}\n💰 Amount: ₹${amountInRupees}`);
      }

      logger.info(`📤 Payment link button sent to ${normalizedTo}`);
      return true;
    } catch (error: any) {
      logger.error(`❌ Error sending payment link to ${to}:`, error.message);
      // Last resort fallback
      return await this.sendMessage(to, `💳 *Payment Link:*\n${paymentUrl}`);
    }
  }

  /**
   * Send an image message via 2Factor API
   */
  async sendImage(to: string, imageUrl: string, caption?: string): Promise<boolean> {
    const url = `${this.baseUrl}/${this.phoneNumberId}/messages`
    const normalizedTo = to.replace('@c.us', '')
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedTo,
      type: "image",
      image: {
        link: imageUrl,
        caption: caption || ''
      }
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': this.apiKey },
        body: JSON.stringify(payload)
      })
      if (!response.ok) throw new Error(`WhatsApp API Error sending image: ${response.status}`)
      logger.info(`📤 Image sent to ${normalizedTo}`)
      return true
    } catch (error: any) {
      logger.error(`❌ Error sending image to ${to}:`, error.message)
      return false
    }
  }

  /**
   * Send document via link using 2Factor API
   */
  async sendDocument(
    to: string,
    filePath: string,
    filename: string,
    caption?: string
  ): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/${this.phoneNumberId}/messages`
      const normalizedTo = to.replace('@c.us', '')

      const ngrokBase = process.env.NGROK_BASE_URL || process.env.BASE_URL || 'http://localhost:3000'
      let docUrl = ''

      // Map local directory to static URL path
      if (filePath.includes('satBara')) docUrl = `${ngrokBase}/files/satBara/${filename}`
      else if (filePath.includes('8a')) docUrl = `${ngrokBase}/files/8a/${filename}`
      else if (filePath.includes('ferFar')) docUrl = `${ngrokBase}/files/ferFar/${filename}`
      else if (filePath.includes('propertyCard')) docUrl = `${ngrokBase}/files/propertyCard/${filename}`
      else docUrl = `${ngrokBase}/files/docs/${filename}`

      const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizedTo,
        type: "document",
        document: {
          link: docUrl,
          filename: filename,
          caption: caption || ''
        }
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey
        },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        throw new Error(`WhatsApp API Error sending document: ${response.status} ${response.statusText}`)
      }

      logger.info(`📤 Outgoing Info: Document sent to ${normalizedTo} | File: ${filename}`)
      return true
    } catch (error: any) {
      logger.error(`❌ Error sending document to ${to}:`, error.message)
      return false
    }
  }
  /**
   * Send WhatsApp List message (Interactive)
   */
  async sendListMessage(
    to: string,
    body: string,
    buttonText: string,
    sections: any[],
    header?: string,
    footer?: string
  ): Promise<boolean> {
    const url = `${this.baseUrl}/${this.phoneNumberId}/messages`
    const normalizedTo = to.replace('@c.us', '')

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedTo,
      type: "interactive",
      interactive: {
        type: "list",
        header: header ? { type: "text", text: header } : undefined,
        body: { text: body },
        footer: footer ? { text: footer } : undefined,
        action: {
          button: buttonText,
          sections: sections
        }
      }
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey
        },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const err = await response.text()
        throw new Error(`WhatsApp API Error (List): ${response.status} ${err}`)
      }
      logger.info(`📤 Outgoing Info: List Message sent to ${normalizedTo} | Button: ${buttonText}`)
      return true
    } catch (error: any) {
      logger.error(`❌ Error sending list message to ${to}:`, error.message)
      return false
    }
  }

  /**
   * Send WhatsApp Reply Buttons (Interactive - max 3 buttons)
   */
  async sendReplyButtons(
    to: string,
    body: string,
    buttons: { id: string, title: string }[],
    header?: string,
    footer?: string
  ): Promise<boolean> {
    const url = `${this.baseUrl}/${this.phoneNumberId}/messages`
    const normalizedTo = to.replace('@c.us', '')

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedTo,
      type: "interactive",
      interactive: {
        type: "button",
        header: header ? { type: "text", text: header } : undefined,
        body: { text: body },
        footer: footer ? { text: footer } : undefined,
        action: {
          buttons: buttons.map(b => ({
            type: "reply",
            reply: { id: b.id, title: b.title }
          }))
        }
      }
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey
        },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const err = await response.text()
        throw new Error(`WhatsApp API Error (Buttons): ${response.status} ${err}`)
      }
      logger.info(`📤 Outgoing Info: Reply Buttons sent to ${normalizedTo} | Count: ${buttons.length}`)
      return true
    } catch (error: any) {
      logger.error(`❌ Error sending reply buttons to ${to}:`, error.message)
      return false
    }
  }

  /**
   * Get media download URL from media ID (Meta Graph API)
   */
  async getMediaUrl(mediaId: string): Promise<string | null> {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || ''
    const url = `https://graph.facebook.com/v21.0/${mediaId}`

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })

      if (!response.ok) {
        const err = await response.text()
        throw new Error(`WhatsApp Media API Error: ${response.status} ${err}`)
      }

      const data = await response.json() as { url: string }
      return data.url
    } catch (error: any) {
      logger.error(`❌ Error fetching media URL for ID ${mediaId}:`, error.message)
      return null
    }
  }

  /**
   * Download media and save to local path
   */
  async downloadMedia(mediaId: string, savePath: string): Promise<boolean> {
    const downloadUrl = await this.getMediaUrl(mediaId)
    if (!downloadUrl) return false

    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || ''

    try {
      const response = await fetch(downloadUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })

      if (!response.ok) {
        throw new Error(`WhatsApp Media Download Error: ${response.status} ${response.statusText}`)
      }

      const buffer = await response.arrayBuffer()
      const fs = await import('fs/promises')
      const path = await import('path')

      // Ensure directory exists
      await fs.mkdir(path.dirname(savePath), { recursive: true })
      await fs.writeFile(savePath, Buffer.from(buffer))

      return true
    } catch (error: any) {
      logger.error(`❌ Error downloading media ${mediaId}:`, error.message)
      return false
    }
  }
}

export const whatsappService = new WhatsAppService()
