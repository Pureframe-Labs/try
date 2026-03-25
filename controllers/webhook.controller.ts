import { Context } from 'hono'
import { sessionManager } from '../services/session-manager.service'
import { logger } from '../utils/logger'

export async function verifyWebhook(c: Context) {
  // Simple GET verification if needed by 2Factor
  const query = c.req.query()
  if (query['hub.challenge']) {
    return c.text(query['hub.challenge'])
  }
  return c.text('EVENT_RECEIVED')
}

export async function handleWebhook(c: Context) {
  try {
    const body = await c.req.json()
    logger.info(`📥 Raw Webhook Received: From Object: ${body.object || 'unknown'} | Entries: ${body.entry?.length || 0}`)
    // Detailed log for the first message to see IDs and Titles
    if (body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
        const msg = body.entry[0].changes[0].value.messages[0];
        logger.debug(`📥 Message Detail: Type: ${msg.type} | ID: ${msg.id} | From: ${msg.from}`);
        if (msg.interactive) {
            logger.info(`📥 Interactive Detail: Row ID: ${msg.interactive.list_reply?.id || msg.interactive.button_reply?.id} | Row Title: ${msg.interactive.list_reply?.title || msg.interactive.button_reply?.title}`);
        }
    }

    // 2Factor / WhatsApp API structure
    if (body.object === 'whatsapp_business_account' || body.entry) {
      const entry = body.entry?.[0]
      const change = entry?.changes?.[0]
      const value = change?.value
      const messages = value?.messages

      if (messages && messages.length > 0) {
        const message = messages[0]
        const senderPhone = message.from
        let text = ''
        let media = null

        if (message.type === 'text') {
          text = message.text.body
        } else if (message.type === 'interactive') {
          if (message.interactive?.button_reply) {
            text = message.interactive.button_reply.id || message.interactive.button_reply.title
          } else if (message.interactive?.list_reply) {
            text = message.interactive.list_reply.id || message.interactive.list_reply.title
          }
        } else if (message.type === 'document') {
          media = {
            type: 'document',
            id: message.document.id,
            filename: message.document.filename,
            mime_type: message.document.mime_type
          }
          text = 'DOCUMENT_RECEIVED'
        }

        if (senderPhone && (text || media)) {
          // Asynchronous processing so we can immediately return 200
          setTimeout(async () => {
             try {
                 const session = await sessionManager.getSession(senderPhone)
                 await sessionManager.handleMessage(senderPhone, text, session, media)
             } catch (e: any) {
                 logger.error('Session handle error:', e.message)
             }
          }, 0)
        }
      }
    }

    // Always respond immediately with 200 OK / EVENT_RECEIVED
    return c.text('EVENT_RECEIVED', 200)
  } catch (error) {
    logger.error('Webhook error:', error)
    // Always return 200 for webhooks to prevent retries on our business logic errors
    return c.text('EVENT_RECEIVED', 200)
  }
}
