/**
 * ============================================================================
 * DOCUMENT SEND SERVICE - Unified file delivery to WhatsApp
 * ============================================================================
 * Single modular function for sending completed documents (7-12, 8a, Ferfar, Property Card)
 * to users via WhatsApp.
 */

import fs from 'fs'
import path from 'path'
import { sql } from '../config/database.config'
import { whatsappService } from './whatsapp.service'

export type DocType = 'property_card' | 'ferfar' | '7_12' | '8a'

const TABLE_MAP: Record<DocType, string> = {
  property_card: 'requests_property_card',
  ferfar: 'requests_ferfar',
  '7_12': 'requests_7_12',
  '8a': 'requests_8a',
}

/** Env keys for download dirs - must match worker DOWNLOAD_DIR_* */
const DOWNLOAD_DIR_ENV: Record<DocType, string> = {
  property_card: 'DOWNLOAD_DIR_PROPERTYCARD',
  ferfar: 'DOWNLOAD_DIR_FERFAR',
  '7_12': 'DOWNLOAD_DIR_SATBARA',
  '8a': 'DOWNLOAD_DIR_8A',
}

function getDownloadPath(doc_type: DocType, filename: string): string {
  const envKey = DOWNLOAD_DIR_ENV[doc_type]
  const envPath = process.env[envKey]
  if (!envPath) {
    throw new Error(`Missing ${envKey} in .env - required for document path`)
  }
  return path.join(process.cwd(), envPath, filename)
}

const SERVICE_NAMES: Record<DocType, string> = {
  property_card: 'Property Card',
  ferfar: 'Ferfar',
  '7_12': '7/12 Form',
  '8a': '8A Form',
}

export interface SendDocumentResult {
  success: boolean
  error?: string
}

/**
 * Send completed document to user via WhatsApp.
 */
export async function sendCompletedDocumentToWhatsApp(
  doc_type: DocType,
  request_id: number,
  pdf_url: string,
  status: string = 'completed'
): Promise<SendDocumentResult> {
  try {
    const tableName = TABLE_MAP[doc_type]
    if (!tableName) {
      return { success: false, error: 'Invalid doc_type' }
    }

    const result = await sql`
      SELECT whatsapp_phone FROM ${sql(tableName as any)} WHERE id = ${request_id}
    `

    if (result.length === 0) {
      return { success: false, error: 'Request not found' }
    }

    const phoneNumber = result[0].whatsapp_phone

    if (status !== 'completed' || !pdf_url) {
      await sql`
        UPDATE ${sql(tableName as any)}
        SET status = ${status}, pdf_url = ${pdf_url || null}, updated_at = NOW()
        WHERE id = ${request_id}
      `
      return { success: true }
    }

    const pdfPath = getDownloadPath(doc_type, pdf_url)

    if (!fs.existsSync(pdfPath)) {
      console.error('❌ PDF not found:', pdfPath)
      return { success: false, error: 'PDF file not found' }
    }

    const chatId = phoneNumber.includes('@')
      ? phoneNumber
      : `${String(phoneNumber).replace(/\D/g, '')}@c.us`

    const caption = `✅ Your ${SERVICE_NAMES[doc_type]} is ready!\n📄 Request ID: ${request_id}`

    /**
     * SUCCESS IMAGE LOGIC
     * Uses the public URL from .env (e.g., ngrok URL)
     */
    const ngrokBase = process.env.NGROK_BASE_URL || process.env.BASE_URL || 'http://localhost:3000'
    const successImageUrl = process.env.SUCCESS_IMAGE_URL || `${ngrokBase}/img/pdf_arrived.png`

    try {
      await whatsappService.sendImage(
        chatId,
        successImageUrl,
        `✅ ${SERVICE_NAMES[doc_type]} Ready! Your document is being sent now.`
      )
    } catch (imgErr) {
      console.warn('⚠️ Could not send success image, proceeding to PDF:', imgErr)
    }

    // Send the actual PDF document
    const sent = await whatsappService.sendDocument(
      chatId,
      pdfPath,
      pdf_url,
      caption
    )

    if (!sent) {
      return { success: false, error: 'Failed to send WhatsApp document' }
    }

    await sql`
      UPDATE ${sql(tableName as any)}
      SET status = 'completed', pdf_url = ${pdf_url}, updated_at = NOW()
      WHERE id = ${request_id}
    `

    console.log(`✅ Document sent: ${doc_type} request ${request_id} → ${chatId}`)
    return { success: true }
  } catch (err: any) {
    console.error(`❌ Document send error (${doc_type} #${request_id}):`, err)
    return { success: false, error: err.message }
  }
}