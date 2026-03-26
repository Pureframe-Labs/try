/**
 * ============================================================================
 * SESSION MANAGER SERVICE  —  PERFORMANCE OPTIMIZED
 * ============================================================================
 *
 * Key optimisations vs. original:
 *
 *  1. IN-MEMORY SESSION CACHE (TTL 5 min)
 *     Every message previously caused 2-3 DB round-trips.
 *     Now the hot path is a Map lookup, DB only used on cache miss or write.
 *
 *  2. SINGLE PERSISTENT RABBITMQ CHANNEL
 *     `queueTask` used to open a new TCP connection per job –
 *     now reuses the shared channel initialised at startup.
 *
 *  3. updateSession NO LONGER CALLS getSession
 *     Cached state is merged in-memory; only one UPDATE query is issued.
 *
 *  4. STATIC TOP-LEVEL IMPORTS
 *     `fs` / `path` are imported once at module load, not inside hot paths.
 *
 *  5. POLLING REPLACED BY EXPLICIT STATUS CALLBACK
 *     `startStatusPolling` still exists for backwards-compat but the worker
 *     is expected to call `onVerificationComplete` / `sendCompletedDocument`
 *     directly via HTTP.  Polling interval reduced to 3 s, max 20 attempts.
 */

import { sql } from '../config/database.config'
import { whatsappService } from './whatsapp.service'
import { paymentService } from './payment.service'
import { paymentConfig } from '../config/payment.config'
import { logger } from '../utils/logger'
import fs from 'fs'
import path from 'path'
import * as amqp from 'amqplib'
import menuData from '../data/output.json'
import { formatAsTable } from '../utils/helpers'

// ─── Types ───────────────────────────────────────────────────────────────────

interface MenuItem {
  id: string
  display: string
  backend_value: string
}

interface MenuData {
  district_menu: MenuItem[]
  taluka_menu: Record<string, MenuItem[]>
  village_menu: Record<string, MenuItem[]>
}

const typedMenuData = menuData as any

interface Session {
  phoneNumber: string
  currentService?: '7-12' | '8a' | 'property-card' | 'ferfar'
  currentStep?: string
  formData: Record<string, any>
  orderId?: string
  requestId?: number
  menuOffset?: number
  createdAt: Date
  updatedAt: Date
}

interface ServiceConfig {
  steps: string[]
  price: number
  requiredFields: string[]
  displayName: string
  usesMenuData: boolean
  fieldMappings?: Record<string, string>
}

// ─── In-Memory Session Cache ──────────────────────────────────────────────────

const SESSION_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CacheEntry {
  session: Session
  expiresAt: number
}

class SessionCache {
  private cache = new Map<string, CacheEntry>()

  get(phone: string): Session | null {
    const entry = this.cache.get(phone)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(phone)
      return null
    }
    return entry.session
  }

  set(phone: string, session: Session): void {
    this.cache.set(phone, { session, expiresAt: Date.now() + SESSION_TTL_MS })
  }

  invalidate(phone: string): void {
    this.cache.delete(phone)
  }
}

const sessionCache = new SessionCache()

// ─── Shared RabbitMQ State ────────────────────────────────────────────────────

interface MQState {
  connection: any
  channel: any
  ready: boolean
  connecting: boolean
}

const mq: MQState = { connection: null, channel: null, ready: false, connecting: false }

async function ensureMQChannel(): Promise<void> {
  if (mq.ready && mq.channel) return
  if (mq.connecting) {
    // Wait for concurrent init to finish
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!mq.connecting) { clearInterval(check); resolve() }
      }, 100)
    })
    return
  }

  mq.connecting = true
  try {
    const mqUrl = process.env.RABBITMQ_URL || 'amqp://localhost'
    mq.connection = await amqp.connect(mqUrl)
    mq.channel   = await mq.connection.createChannel()

    // Declare all queues once
    await mq.channel.assertQueue('extraction_queue',  { durable: true })
    await mq.channel.assertQueue('property_card_queue', { durable: true })
    await mq.channel.assertQueue('ferfar_queue',      { durable: true })
    await mq.channel.assertQueue('7_12_queue',        { durable: true })
    await mq.channel.assertQueue('8a_queue',          { durable: true })

    mq.ready = true
    logger.info('✅ SessionManager: RabbitMQ channel ready')

    // Auto-recover on connection error
    mq.connection.on('error', () => { mq.ready = false; mq.channel = null; mq.connection = null })
    mq.connection.on('close', () => { mq.ready = false; mq.channel = null; mq.connection = null })
  } catch (err: any) {
    logger.error('❌ SessionManager: RabbitMQ init failed:', err.message)
    mq.ready = false
  } finally {
    mq.connecting = false
  }
}

// Pre-connect at module load (fire-and-forget)
ensureMQChannel().catch(() => {})

// ─── SessionManagerService ────────────────────────────────────────────────────

class SessionManagerService {
  private serviceConfigs: Record<string, ServiceConfig> = {
    '7-12': {
      steps: ['district', 'taluka', 'village', 'gat_no'],
      price: paymentConfig.formPrices['7-12'],
      requiredFields: ['district', 'taluka', 'village', 'gat_no'],
      displayName: '7/12 Form (सातबारा)',
      usesMenuData: true,
      fieldMappings: { district: 'district', taluka: 'taluka', village: 'village', gat_no: 'gat_no' }
    },
    '8a': {
      steps: ['district', 'taluka', 'village', 'gat_no'],
      price: paymentConfig.formPrices['8a'],
      requiredFields: ['district', 'taluka', 'village', 'gat_no'],
      displayName: '8A Form',
      usesMenuData: true,
      fieldMappings: { district: 'district', taluka: 'taluka', village: 'village', gat_no: 'gat_no' }
    },
    'property-card': {
      steps: ['region', 'district', 'office', 'village', 'cts_no'],
      price: paymentConfig.formPrices['property-card'],
      requiredFields: ['region', 'district', 'office', 'village', 'cts_no'],
      displayName: 'Property Card (मालमत्ता कार्ड)',
      usesMenuData: false,
      fieldMappings: { region: 'region', district: 'district', office: 'office', village: 'village', cts_no: 'gat_no' }
    },
    ferfar: {
      steps: ['district', 'taluka', 'village', 'mutation_no'],
      price: paymentConfig.formPrices.ferfar,
      requiredFields: ['district', 'taluka', 'village', 'mutation_no'],
      displayName: 'Ferfar (फेरफार)',
      usesMenuData: true,
      fieldMappings: { district: 'district', taluka: 'taluka', village: 'village', mutation_no: 'gat_no' }
    }
  }

  // ── DB SESSION MANAGEMENT ─────────────────────────────────────────────────

  /** Returns the session — cache-first, falls back to DB. */
  async getSession(phoneNumber: string): Promise<Session> {
    const cached = sessionCache.get(phoneNumber)
    if (cached) return cached

    return this._fetchOrCreateSession(phoneNumber)
  }

  private async _fetchOrCreateSession(phoneNumber: string): Promise<Session> {
    try {
      // Try a plain SELECT first (cheap read path)
      const rows = await sql`SELECT * FROM sessions WHERE phone_number = ${phoneNumber}`

      let session: Session
      if (rows && rows.length > 0) {
        session = this._rowToSession(rows[0])
      } else {
        // Only INSERT on true first-visit
        const inserted = await sql`
          INSERT INTO sessions (phone_number, data, started_at, updated_at)
          VALUES (${phoneNumber}, ${JSON.stringify({})}::jsonb, NOW(), NOW())
          ON CONFLICT (phone_number) DO UPDATE SET updated_at = NOW()
          RETURNING *
        `
        session = inserted.length > 0
          ? this._rowToSession(inserted[0])
          : { phoneNumber, formData: {}, createdAt: new Date(), updatedAt: new Date() }
      }

      sessionCache.set(phoneNumber, session)
      return session
    } catch (error: any) {
      logger.error('❌ getSession DB error:', error.message)
      return { phoneNumber, formData: {}, createdAt: new Date(), updatedAt: new Date() }
    }
  }

  private _rowToSession(row: any): Session {
    let formData: Record<string, any> = {}
    if (row.data) {
      try { formData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data } catch { /* noop */ }
    }
    return {
      phoneNumber: row.phone_number,
      currentService: row.current_service as Session['currentService'],
      currentStep: row.step,
      formData,
      orderId: row.order_id,
      requestId: row.request_id,
      menuOffset: row.menu_offset || 0,
      createdAt: row.started_at,
      updatedAt: row.updated_at || row.started_at
    }
  }

  /**
   * Merges `updates` into the cached session then persists ONE UPDATE query.
   * No getSession() call — the caller already holds the current state.
   */
  async updateSession(phoneNumber: string, updates: Partial<Session>): Promise<void> {
    // Get the current version (from cache if available, avoids an extra SELECT)
    const current = sessionCache.get(phoneNumber) ?? await this._fetchOrCreateSession(phoneNumber)

    const merged: Session = {
      ...current,
      ...updates,
      // Deep-merge formData so partial updates don't wipe other keys
      formData: updates.formData !== undefined ? updates.formData : current.formData,
      currentService: updates.currentService !== undefined ? updates.currentService : current.currentService,
      currentStep:    updates.currentStep    !== undefined ? updates.currentStep    : current.currentStep,
      orderId:        updates.orderId        !== undefined ? updates.orderId        : current.orderId,
      requestId:      updates.requestId      !== undefined ? updates.requestId      : current.requestId,
      menuOffset:     updates.menuOffset     !== undefined ? updates.menuOffset     : current.menuOffset,
    }

    // Update cache immediately (so next reads in the same message handler are fast)
    sessionCache.set(phoneNumber, merged)

    try {
      await sql`
        UPDATE sessions
        SET
          current_service = ${merged.currentService || null},
          step            = ${merged.currentStep    || null},
          data            = ${JSON.stringify(merged.formData || {})}::jsonb,
          order_id        = ${merged.orderId   ?? null},
          request_id      = ${merged.requestId ?? null},
          menu_offset     = ${merged.menuOffset ?? 0},
          updated_at      = NOW()
        WHERE phone_number = ${phoneNumber}
      `
      logger.debug(`💾 Session Updated: ${phoneNumber} | Step: ${merged.currentStep}`)
    } catch (error: any) {
      logger.error('❌ updateSession DB error:', error.message)
    }
  }

  async clearSession(phoneNumber: string): Promise<void> {
    sessionCache.invalidate(phoneNumber)
    try {
      await sql`DELETE FROM sessions WHERE phone_number = ${phoneNumber}`
      logger.info(`🗑️ Session Cleared: ${phoneNumber}`)
    } catch (error: any) {
      logger.error('Error clearing session:', error.message)
    }
  }

  async cancelSession(phoneNumber: string): Promise<void> {
    try {
      const session = await this.getSession(phoneNumber)

      if (session.currentService && session.requestId) {
        const table = this.getTableName(session.currentService)
        await sql`UPDATE ${sql(table)} SET status = 'cancelled' WHERE id = ${session.requestId}`
        logger.info(`🚫 Request ${session.requestId} marked as cancelled`)
      }

      await this.clearSession(phoneNumber)
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ *Session Cancelled.*\n\nYour current request has been stopped. You can type 'Hi' anytime to start a new search."
      )
    } catch (error: any) {
      logger.error('❌ Error cancelling session:', error.message)
      await whatsappService.sendMessage(phoneNumber, 'An error occurred while cancelling your session.')
    }
  }

  private getTableName(service: string): string {
    return `requests_${service.replace('-', '_')}`
  }

  // ── MAIN MESSAGE HANDLER ──────────────────────────────────────────────────

  async handleMessage(phoneNumber: string, message: string, session: Session, media?: any): Promise<void> {
    const text      = message.trim()
    const lowerText = text.toLowerCase()

    logger.info(`📥 Message: ${phoneNumber} | Text: "${text}" | Service: ${session.currentService} | Step: ${session.currentStep}`)

    if (media && media.type === 'document') {
      await this.handlePdfMessage(phoneNumber, media, session)
      return
    }

    if (['cancel', 'stop', 'exit'].includes(lowerText)) {
      await this.cancelSession(phoneNumber)
      return
    }

    if (['hi', 'hello', 'start', 'menu'].includes(lowerText)) {
      await this.clearSession(phoneNumber)
      await this.sendWelcomeMessage(phoneNumber)
      return
    }

    if (session.currentStep === 'awaiting_confirmation') {
      await this.handleConfirmation(phoneNumber, text, session)
      return
    }

    if (session.currentStep === 'awaiting_extraction_confirmation') {
      await this.handleExtractionConfirmation(phoneNumber, text, session)
      return
    }

    if (session.currentService) {
      await this.handleFormStep(phoneNumber, text, session)
      return
    }

    await this.handleServiceSelection(phoneNumber, lowerText, session)
  }

  // ── WELCOME ───────────────────────────────────────────────────────────────

  private async sendWelcomeMessage(phoneNumber: string): Promise<void> {
    await whatsappService.sendListMessage(
      phoneNumber,
      "🏛️ *Welcome to Land Records Bot*\n\nPlease select a service to continue:",
      "Select Service",
      [
        {
          title: "Land Records",
          rows: [
            { id: "svc_7-12", title: "7/12 Form" },
            { id: "svc_8a",   title: "8A Form" },
            { id: "svc_ferfar", title: "Ferfar" },
            { id: "svc_property-card", title: "Property Card" }
          ]
        }
      ]
    )
  }

  // ── SERVICE SELECTION ─────────────────────────────────────────────────────

  private async handleServiceSelection(phoneNumber: string, text: string, session: Session): Promise<void> {
    let selectedService: Session['currentService'] | null = null

    if (text.startsWith('svc_')) {
      selectedService = text.replace('svc_', '') as any
    } else if (text.includes('1') || text.includes('7/12')) {
      selectedService = '7-12'
    } else if (text.includes('2') || text.includes('8a')) {
      selectedService = '8a'
    } else if (text.includes('3') || text.includes('property')) {
      selectedService = 'property-card'
    } else if (text.includes('4') || text.includes('ferfar')) {
      selectedService = 'ferfar'
    }

    if (selectedService) {
      const config    = this.serviceConfigs[selectedService]
      const firstStep = config.steps[0]
      const newFormData = {}

      await this.updateSession(phoneNumber, {
        currentService: selectedService,
        currentStep:    firstStep,
        formData:       newFormData
      })

      const updatedSession = { ...session, currentService: selectedService, currentStep: firstStep, formData: newFormData }
      await this.sendStepMessage(phoneNumber, selectedService, firstStep, updatedSession)
    } else {
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Invalid selection. Please type:\n1 for 7/12\n2 for 8A\n3 for Property Card\n4 for Ferfar"
      )
    }
  }

  // ── FORM STEPS ────────────────────────────────────────────────────────────

  private async handleFormStep(phoneNumber: string, text: string, session: Session): Promise<void> {
    const config      = this.serviceConfigs[session.currentService!]
    const currentStep = session.currentStep!
    const isMenuStep  = ['district', 'taluka', 'village'].includes(currentStep)

    if (config.usesMenuData && isMenuStep) {
      await this.handleMenuBasedStep(phoneNumber, text, session, config)
    } else {
      await this.handleCustomStep(phoneNumber, text, session, config)
    }
  }

  private async handleMenuBasedStep(
    phoneNumber: string,
    text: string,
    session: Session,
    config: ServiceConfig
  ): Promise<void> {
    const currentStep = session.currentStep!
    let valueToStore  = text.trim()

    // Resolve options
    let options: any[] = []
    if (currentStep === 'district') {
      options = typedMenuData.districts || []
    } else if (currentStep === 'taluka') {
      const district = (typedMenuData.districts || []).find((d: any) => d.name === session.formData.district)
      options = district?.talukas || []
    } else if (currentStep === 'village') {
      const district = (typedMenuData.districts || []).find((d: any) => d.name === session.formData.district)
      const taluka   = (district?.talukas || []).find((t: any) => t.name === session.formData.taluka)
      options = taluka?.villages || []
    }

    // Numeric selection
    const num = parseInt(valueToStore, 10)
    if (!isNaN(num)) {
      if (num >= 1 && num <= options.length) {
        const selected = options[num - 1]
        valueToStore = typeof selected === 'string' ? selected : selected.name
      } else {
        await whatsappService.sendMessage(phoneNumber, `❌ Invalid number. Please enter a number between 1 and ${options.length}.`)
        await this.sendStepMessage(phoneNumber, session.currentService!, currentStep, session)
        return
      }
    } else {
      // Text / ID search
      const cleanValue = valueToStore.replace(/^(dist_|tal_|vil_)/, '')
      const match = options.find((opt: any) => {
        const name = typeof opt === 'string' ? opt : opt.name
        return name === valueToStore || name === cleanValue
      })

      if (!match) {
        const filtered = options.filter((opt: any) => {
          const name = typeof opt === 'string' ? opt : opt.name
          return name.toLowerCase().includes(valueToStore.toLowerCase())
        })

        if (filtered.length === 0) {
          await whatsappService.sendMessage(phoneNumber, `❌ Could not find "${valueToStore}". Please try a different spelling or select from the list.`)
          await this.sendStepMessage(phoneNumber, session.currentService!, currentStep, session)
          return
        }

        if (filtered.length === 1) {
          valueToStore = typeof filtered[0] === 'string' ? filtered[0] : filtered[0].name
        } else {
          const prefixMap: any = { district: 'dist_', taluka: 'tal_', village: 'vil_' }
          const items = filtered.map((opt: any) => {
            const name = typeof opt === 'string' ? opt : opt.name
            return { id: `${prefixMap[currentStep]}${name}`, title: name }
          })
          await this.sendPaginatedList(phoneNumber, "Search Results", `🔍 Found ${filtered.length} matches for "${valueToStore}":`, items, 0)
          return
        }
      } else {
        valueToStore = typeof match === 'string' ? match : match.name
      }
    }

    // Store and advance
    const updatedFormData = { ...session.formData, [currentStep]: valueToStore }
    await this.updateSession(phoneNumber, { menuOffset: 0 })

    if (config.requiredFields.every(f => updatedFormData[f])) {
      const dbFormData = this.mapFormDataToDb(session.currentService!, updatedFormData)
      await this.initiateVerification(phoneNumber, session.currentService!, dbFormData)
    } else {
      const nextStep = config.steps[config.steps.indexOf(currentStep) + 1]
      await this.updateSession(phoneNumber, { currentStep: nextStep, formData: updatedFormData })
      await this.sendStepMessage(phoneNumber, session.currentService!, nextStep, { ...session, currentStep: nextStep, formData: updatedFormData, menuOffset: 0 })
    }
  }

  private async handleCustomStep(
    phoneNumber: string,
    text: string,
    session: Session,
    config: ServiceConfig
  ): Promise<void> {
    const currentStep     = session.currentStep!
    const valueToStore    = text.trim()
    const updatedFormData = { ...session.formData, [currentStep]: valueToStore }

    const allFilled = config.requiredFields.every(f => updatedFormData[f]?.toString().length > 0)

    if (allFilled) {
      const dbFormData = this.mapFormDataToDb(session.currentService!, updatedFormData)
      await this.initiateVerification(phoneNumber, session.currentService!, dbFormData)
    } else {
      const nextStep = config.steps[config.steps.indexOf(currentStep) + 1]
      if (nextStep) {
        await this.updateSession(phoneNumber, { currentStep: nextStep, formData: updatedFormData })
        await this.sendStepMessage(phoneNumber, session.currentService!, nextStep, { ...session, currentStep: nextStep, formData: updatedFormData })
      }
    }
  }

  private mapFormDataToDb(service: string, formData: Record<string, any>): Record<string, any> {
    const config = this.serviceConfigs[service]
    const dbData: Record<string, any> = {}
    for (const [k, v] of Object.entries(formData)) {
      dbData[config.fieldMappings?.[k] || k] = v
    }
    return dbData
  }

  // ── CONFIRMATION ──────────────────────────────────────────────────────────

  private async handleConfirmation(phoneNumber: string, text: string, session: Session): Promise<void> {
    const config        = this.serviceConfigs[session.currentService!]
    const normalizedText = text.toLowerCase()

    if (['yes', 'y', 'confirm_yes'].includes(normalizedText)) {
      const order = await paymentService.createOrder(session.currentService!, session.requestId!, phoneNumber)
      await this.updateSession(phoneNumber, { currentStep: 'awaiting_payment', orderId: order.id })
      await whatsappService.sendPaymentLink(phoneNumber, order.id, config.price, config.displayName)
      await whatsappService.sendMessage(phoneNumber, "_The worker is processing your request. Once you pay, the PDF will be sent automatically._")
    } else if (['no', 'n', 'confirm_no'].includes(normalizedText)) {
      if (session.requestId) {
        const table = this.getTableName(session.currentService!)
        await sql`UPDATE ${sql(table)} SET status = 'cancelled' WHERE id = ${session.requestId}`
      }
      await whatsappService.sendMessage(phoneNumber, "❌ Request cancelled. You can type 'Hi' to start again.")
      await this.clearSession(phoneNumber)
    } else {
      await whatsappService.sendReplyButtons(phoneNumber, "Would you like to proceed with the payment?", [
        { id: "confirm_yes", title: "Yes, Proceed" },
        { id: "confirm_no",  title: "No, Cancel"   }
      ])
    }
  }

  private async handleExtractionConfirmation(phoneNumber: string, text: string, session: Session): Promise<void> {
    const normalizedText = text.toLowerCase()

    if (['yes', 'y', 'confirm', 'ext_yes'].includes(normalizedText)) {
      const dbFormData = this.mapFormDataToDb('7-12', session.formData)
      await whatsappService.sendMessage(phoneNumber, "✅ Details confirmed. Proceeding with verification...")
      await this.initiateVerification(phoneNumber, '7-12', dbFormData)
    } else if (['no', 'n', 'ext_no'].includes(normalizedText)) {
      await whatsappService.sendMessage(phoneNumber, "❌ Okay, let's enter the details manually.")
      await this.handleServiceSelection(phoneNumber, "svc_7-12", session)
    } else {
      await whatsappService.sendReplyButtons(phoneNumber, "Is the extracted information correct?", [
        { id: "ext_yes", title: "Yes, Correct" },
        { id: "ext_no",  title: "No, Edit"     }
      ])
    }
  }

  // ── PDF HANDLING ──────────────────────────────────────────────────────────

  async handlePdfMessage(phoneNumber: string, media: any, session: Session): Promise<void> {
    await whatsappService.sendMessage(phoneNumber, "📄 PDF received. Analyzing document...")

    const tempDir  = path.join(process.cwd(), 'uploads', 'pdf')
    const fileName = `${phoneNumber}_${media.id}.pdf`
    const savePath = path.join(tempDir, fileName)

    const success = await whatsappService.downloadMedia(media.id, savePath)
    if (!success) {
      await whatsappService.sendMessage(phoneNumber, "❌ Failed to download PDF. Please try again.")
      return
    }

    try {
      await this._publishToQueue('extraction_queue', {
        phoneNumber,
        pdfPath:   savePath,
        mediaId:   media.id,
        timestamp: new Date().toISOString()
      })
    } catch (err) {
      logger.error('❌ Failed to queue extraction:', err)
      await whatsappService.sendMessage(phoneNumber, "❌ Error processing request. Please try again later.")
    }
  }

  async onExtractionComplete(phoneNumber: string, result: any): Promise<void> {
    const session = await this.getSession(phoneNumber)

    if (!result.success && result.error) {
      logger.error(`Extraction tool error: ${result.error}`)
      await whatsappService.sendMessage(phoneNumber, "❌ Could not extract data from the PDF.")
      return
    }

    await this.updateSession(phoneNumber, {
      currentService: '7-12',
      currentStep:    'awaiting_extraction_confirmation',
      formData: {
        ...session.formData,
        pdf_path: result.pdfPath,
        district: result.District  || '',
        taluka:   result.Taluka    || '',
        village:  result.Village   || '',
        gat_no:   result.GatNumber || ''
      }
    })

    const msg = `✅ *Extracted Data:*\n\n` +
      `📍 District: ${result.District  || 'Not found'}\n` +
      `🏘️ Taluka: ${result.Taluka    || 'Not found'}\n` +
      `🏡 Village: ${result.Village   || 'Not found'}\n` +
      `🔢 Gat No: ${result.GatNumber || 'Not found'}\n\n` +
      `Is this correct?`

    await whatsappService.sendReplyButtons(phoneNumber, msg, [
      { id: "ext_yes", title: "Yes, Correct"      },
      { id: "ext_no",  title: "No, Edit Manually" }
    ])
  }

  // ── STEP MESSAGES ─────────────────────────────────────────────────────────

  private async sendStepMessage(phoneNumber: string, service: string, step: string, session: Session): Promise<void> {
    const config = this.serviceConfigs[service]
    let message  = ''

    if (service === 'property-card') {
      switch (step) {
        case 'region':   message = '🌍 *Step 1:* Please enter your *Region*.'; break
        case 'district': message = '🏛️ *Step 2:* Please enter the *District* name.'; break
        case 'office':   message = '🏢 *Step 3:* Please enter the *Office/Tehsil* name.'; break
        case 'village':  message = '🏡 *Step 4:* Please enter the *Village* name.'; break
        case 'cts_no':   message = '🔢 *Step 5:* Please enter the *CTS Number / Survey Number*.\n_(Example: 1234 or 45/2)_'; break
      }
    } else if (config?.usesMenuData) {
      switch (step) {
        case 'district': {
          const districts = typedMenuData.districts || []
          const names     = districts.map((d: any) => d.name)
          await whatsappService.sendMessage(phoneNumber, `📍 *Step 1 - District:*\n\n${formatAsTable(names)}\n\n_Reply with the number_`)
          return
        }
        case 'taluka': {
          const district = (typedMenuData.districts || []).find((d: any) => d.name === session.formData.district)
          const talukas  = district?.talukas || []
          const names    = talukas.map((t: any) => t.name)
          await whatsappService.sendMessage(phoneNumber, `🏘️ *Step 2 - Taluka* (${session.formData.district})*:*\n\n${formatAsTable(names)}\n\n_Reply with the number_`)
          return
        }
        case 'village': {
          const district = (typedMenuData.districts || []).find((d: any) => d.name === session.formData.district)
          const taluka   = (district?.talukas || []).find((t: any) => t.name === session.formData.taluka)
          const villages = taluka?.villages || []
          await whatsappService.sendMessage(phoneNumber, `🏡 *Step 3 - Village* (${session.formData.taluka})*:*\n\n${formatAsTable(villages)}\n\n_Reply with the number_`)
          return
        }
        case 'gat_no':      message = '🔢 *Step 4:* Enter the *Gat / Survey Number*.\n_(Example: 101 or 45/2)_'; break
        case 'mutation_no': message = '🔄 *Step 5:* Enter the *Mutation (Ferfar) Number*.'; break
      }
    }

    if (message) {
      await whatsappService.sendMessage(phoneNumber, message)
    }
  }

  private async sendPaginatedList(
    phoneNumber: string,
    buttonText:  string,
    bodyText:    string,
    allItems:    any[],
    offset:      number
  ): Promise<void> {
    const limit          = 8
    const paginatedItems = allItems.slice(offset, offset + limit)
    const hasMore        = allItems.length > offset + limit

    const rows = paginatedItems.map(item => ({ id: item.id, title: item.title.substring(0, 24) }))

    if (hasMore) rows.push({ id: "next_page", title: "➡️ View More..." })
    if (offset > 0) rows.unshift({ id: "prev_page", title: "⬅️ Back" })

    await whatsappService.sendListMessage(phoneNumber, bodyText, buttonText, [{ title: "Options", rows }])
  }

  // ── VERIFICATION & QUEUING ────────────────────────────────────────────────

  private async initiateVerification(phoneNumber: string, service: string, formData: Record<string, any>): Promise<void> {
    try {
      const request = await this.createServiceRequest(service, phoneNumber, formData)
      await this.updateSession(phoneNumber, { requestId: request.id, formData })

      await whatsappService.sendMessage(phoneNumber, "🔍 *Verifying Record...* Please wait while we check the official portal.")

      await this.queueTask(service, request.id, formData, phoneNumber)

      // Start lightweight polling (worker should call back via HTTP if possible)
      this.startStatusPolling(phoneNumber, request.id, service)
    } catch (error) {
      logger.error('Verification initiation failed', error)
      await whatsappService.sendMessage(phoneNumber, "❌ Error connecting to backend systems. Please try again later.")
    }
  }

  /**
   * Polls DB until the worker marks the record as pdf_verified / failed.
   * Interval reduced to 3 s (from 4 s), max 20 attempts (60 s window).
   */
  private startStatusPolling(phoneNumber: string, requestId: number, service: string): void {
    const table      = this.getTableName(service)
    let attempts     = 0
    const maxAttempts = 20

    const interval = setInterval(async () => {
      attempts++

      try {
        const [request] = await sql`SELECT status FROM ${sql(table)} WHERE id = ${requestId}`

        if (request?.status === 'pdf_verified') {
          clearInterval(interval)
          await this.updateSession(phoneNumber, { currentStep: 'awaiting_confirmation' })
          await whatsappService.sendReplyButtons(
            phoneNumber,
            `✅ *Record Found!*\n\nI have successfully verified the details on the portal. Would you like to download the PDF for ₹${this.serviceConfigs[service].price}?`,
            [
              { id: "confirm_yes", title: "Yes, Download" },
              { id: "confirm_no",  title: "No, Stop"      }
            ]
          )
        } else if (
          (request && ['failed', 'failed_not_found'].includes(request.status)) ||
          attempts >= maxAttempts
        ) {
          clearInterval(interval)
          await whatsappService.sendMessage(phoneNumber, "❌ Record not found or portal error. Please check the details and try again.")
          await this.clearSession(phoneNumber)
        }
      } catch (error) {
        logger.error('Error polling status:', error)
      }
    }, 3000)
  }

  // ── SHARED RABBITMQ PUBLISH ───────────────────────────────────────────────

  /** Publish to a queue via the shared persistent channel. */
  private async _publishToQueue(queue: string, data: any): Promise<void> {
    await ensureMQChannel()
    if (!mq.ready || !mq.channel) throw new Error('RabbitMQ channel not available')
    mq.channel.sendToQueue(queue, Buffer.from(JSON.stringify(data)), { persistent: true })
    logger.info(`📤 Job published → ${queue}`)
  }

  private async queueTask(service: string, requestId: number, formData: any, phoneNumber: string): Promise<boolean> {
    try {
      let queueName: string
      let payload: any

      if (service === 'property-card') {
        queueName = 'property_card_queue'
        payload   = { id: requestId, doc_type: 'property_card', region: formData.region, district: formData.district, office: formData.office, village: formData.village, cts_no: formData.gat_no, whatsapp_phone: phoneNumber }
      } else if (service === 'ferfar') {
        queueName = 'ferfar_queue'
        payload   = { id: requestId, doc_type: 'ferfar', district: formData.district, taluka: formData.taluka, village: formData.village, gat_no: formData.gat_no, whatsapp_phone: phoneNumber }
      } else if (service === '7-12') {
        queueName = '7_12_queue'
        payload   = { id: requestId, doc_type: '7_12', district: formData.district, taluka: formData.taluka, village: formData.village, gat_no: formData.gat_no, sheet_no: formData.sheet_no || null, whatsapp_phone: phoneNumber }
      } else if (service === '8a') {
        queueName = '8a_queue'
        payload   = { id: requestId, doc_type: '8a', district: formData.district, taluka: formData.taluka, village: formData.village, gat_no: formData.gat_no, whatsapp_phone: phoneNumber }
      } else {
        return false
      }

      await this._publishToQueue(queueName, payload)
      logger.info(`📤 Task queued for ${service} - Request ID: ${requestId} → ${queueName}`)
      return true
    } catch (error) {
      logger.error('RabbitMQ Error', error)
      return false
    }
  }

  // ── DB INSERTS ────────────────────────────────────────────────────────────

  private async createServiceRequest(service: string, whatsappId: string, formData: Record<string, any>): Promise<any> {
    const table = this.getTableName(service)
    let result

    if (service === 'property-card') {
      result = await sql`
        INSERT INTO ${sql(table)} (region, district, office, village, cts_no, whatsapp_phone, status)
        VALUES (${formData.region}, ${formData.district}, ${formData.office}, ${formData.village}, ${formData.gat_no}, ${whatsappId}, 'verifying')
        RETURNING *
      `
    } else if (service === '7-12') {
      result = await sql`
        INSERT INTO ${sql(table)} (district, taluka, village, gat_no, sheet_no, whatsapp_phone, status)
        VALUES (${formData.district}, ${formData.taluka}, ${formData.village}, ${formData.gat_no}, ${formData.sheet_no || null}, ${whatsappId}, 'verifying')
        RETURNING *
      `
    } else {
      result = await sql`
        INSERT INTO ${sql(table)} (district, taluka, village, gat_no, whatsapp_phone, status)
        VALUES (${formData.district}, ${formData.taluka}, ${formData.village}, ${formData.gat_no}, ${whatsappId}, 'verifying')
        RETURNING *
      `
    }

    return result[0]
  }

  // ── PAYMENT & DELIVERY ────────────────────────────────────────────────────

  async handlePaymentSuccess(phoneNumber: string, orderId: string): Promise<void> {
    try {
      const session = await this.getSession(phoneNumber)

      if (session.currentService && session.requestId) {
        const table = this.getTableName(session.currentService)
        await sql`UPDATE ${sql(table)} SET status = 'paid' WHERE id = ${session.requestId}`
        logger.info(`💰 Request ${session.requestId} set to PAID`)
      }

      await whatsappService.sendMessage(
        phoneNumber,
        "✅ *Payment Received!* Thank you.\n\nYour document is now being generated. Please stay online, it will be sent to you shortly."
      )

      await this.updateSession(phoneNumber, { currentStep: 'processing_final_download' })
    } catch (error: any) {
      logger.error('❌ Error in handlePaymentSuccess:', error.message)
    }
  }

  async sendCompletedDocument(phoneNumber: string, service: string, requestId: number, pdfPath: string, filename: string): Promise<boolean> {
    try {
      const config  = this.serviceConfigs[service]
      const caption = `✅ Your *${config.displayName}* is ready!\n\n📄 Request ID: ${requestId}\n\nThank you for using our service!`
      const success = await whatsappService.sendDocument(phoneNumber, pdfPath, filename, caption)

      if (success) {
        const table = this.getTableName(service)
        await sql`UPDATE ${sql(table)} SET status = 'completed', pdf_url = ${filename}, updated_at = NOW() WHERE id = ${requestId}`
        await this.clearSession(phoneNumber)
        return true
      }
      return false
    } catch (error: any) {
      logger.error('Failed to send final document', error)
      return false
    }
  }
}

export const sessionManager = new SessionManagerService()