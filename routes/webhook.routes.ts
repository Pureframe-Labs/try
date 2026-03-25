import { Hono } from 'hono'
import { handleWebhook, verifyWebhook } from '../controllers/webhook.controller'

const webhookRoutes = new Hono()

// WhatsApp Webhook Endpoints
webhookRoutes.get('/whatsapp', verifyWebhook)
webhookRoutes.post('/whatsapp', handleWebhook)

export default webhookRoutes
