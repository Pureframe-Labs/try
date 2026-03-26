import { Context } from 'hono'
import { sessionManager } from '../services/session-manager.service'
import { logger } from '../utils/logger'

// ─── Deduplication ────────────────────────────────────────────────────────────
// WhatsApp Cloud API often re-delivers the same event if our 200 is late.
// We keep the last N processed message-IDs in a fixed-size ring buffer so
// duplicate deliveries are dropped before any DB or RabbitMQ work happens.

const DEDUP_SIZE = 512
const processedIds = new Set<string>()
const idRing: string[] = []

function isDuplicate(msgId: string): boolean {
  if (processedIds.has(msgId)) return true

  // Evict oldest when the ring is full
  if (idRing.length >= DEDUP_SIZE) {
    const oldest = idRing.shift()!
    processedIds.delete(oldest)
  }

  idRing.push(msgId)
  processedIds.add(msgId)
  return false
}

// ─── Handlers ────────────────────────────────────────────────────────────────

export async function verifyWebhook(c: Context) {
  const query = c.req.query()
  if (query['hub.challenge']) return c.text(query['hub.challenge'])
  return c.text('EVENT_RECEIVED')
}

export async function handleWebhook(c: Context) {
  // Always return 200 immediately — Meta will retry if we don't
  // All processing is fire-and-forget below.
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.text('EVENT_RECEIVED', 200)
  }

  logger.info(`📥 Webhook: object=${body.object || 'unknown'} entries=${body.entry?.length || 0}`)

  // Fire-and-forget — response is NOT awaited
  processWebhookBody(body).catch((e: any) => logger.error('Webhook processing error:', e.message))

  return c.text('EVENT_RECEIVED', 200)
}

async function processWebhookBody(body: any): Promise<void> {
  if (!body.object && !body.entry) return

  const entry    = body.entry?.[0]
  const change   = entry?.changes?.[0]
  const value    = change?.value
  const messages = value?.messages

  if (!messages || messages.length === 0) return

  const message     = messages[0]
  const senderPhone = message.from

  // ── Deduplication ──
  if (message.id && isDuplicate(message.id)) {
    logger.debug(`⚡ Duplicate webhook dropped: ${message.id}`)
    return
  }

  let text  = ''
  let media = null

  if (message.type === 'text') {
    text = message.text?.body || ''

  } else if (message.type === 'interactive') {
    if (message.interactive?.button_reply) {
      text = message.interactive.button_reply.id || message.interactive.button_reply.title
      logger.info(`📥 Button: id=${text}`)
    } else if (message.interactive?.list_reply) {
      text = message.interactive.list_reply.id || message.interactive.list_reply.title
      logger.info(`📥 List: id=${text}`)
    }

  } else if (message.type === 'document') {
    media = {
      type:      'document',
      id:        message.document.id,
      filename:  message.document.filename,
      mime_type: message.document.mime_type,
    }
    text = 'DOCUMENT_RECEIVED'
  }

  if (!senderPhone || (!text && !media)) return

  try {
    const session = await sessionManager.getSession(senderPhone)
    await sessionManager.handleMessage(senderPhone, text, session, media)
  } catch (e: any) {
    logger.error(`Session handle error for ${senderPhone}:`, e.message)
  }
}
