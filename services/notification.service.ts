/**
 * ============================================================================
 * NOTIFICATION SERVICE
 * ============================================================================
 * 
 * Purpose:
 * Dedicated service for sending status updates and documents to users.
 * Slightly overlaps with `document-send.service.ts`, but focuses more on 
 * generic notifications and status updates.
 */

import { whatsappService } from './whatsapp.service'
import { sql } from '../config/database.config'
import { logger } from '../utils/logger'

class NotificationService {
    /**
     * Sends a document (PDF) to the user with a formatted caption.
     * 
     * @param phoneNumber WhatsApp ID (can be raw number)
     * @param service Service name for caption
     * @param requestId Request ID
     * @param pdfPath Absolute path to the PDF
     * @param filename Filename for the attachment
     */
    async sendDocumentNotification(
        phoneNumber: string,
        service: string,
        requestId: number,
        pdfPath: string,
        filename: string
    ): Promise<boolean> {
        try {
            const cleanPhone = phoneNumber.replace('@c.us', '').replace('@lid', '')

            logger.info(`Sending document to ${cleanPhone}: ${filename}`)

            const serviceNames: Record<string, string> = {
                '7-12': '7/12 Form',
                '8a': '8A Form',
                'property-card': 'Property Card',
                'ferfar': 'Ferfar'
            }

            const serviceName = serviceNames[service] || service

            const caption = `✅ *Your ${serviceName} is ready!*\n\nRequest ID: ${requestId}\n\nThank you for using our service!`

            const success = await whatsappService.sendDocument(
                cleanPhone,
                pdfPath,
                filename,
                caption
            )

            if (success) {
                logger.info(`✅ Document sent successfully to ${cleanPhone}`)
                return true
            } else {
                logger.error(`❌ Failed to send document to ${cleanPhone}`)
                return false
            }
        } catch (error: any) {
            logger.error(`Error sending document notification: ${error.message}`)
            return false
        }
    }

    /**
     * Orchestrates the full "Document Ready" workflow:
     * 1. Fetches user phone number from Request table.
     * 2. Sends the document.
     * 3. Updates the Request status to 'completed'.
     */
    async notifyDocumentReady(
        requestId: number,
        service: string,
        pdfPath: string,
        filename: string
    ): Promise<void> {
        try {
            // Get request details from database
            const table = `requests_${service.replace('-', '_')}`
            const result = await sql`
        SELECT whatsapp_phone FROM ${sql(table)} WHERE id = ${requestId}
      `

            if (result.length === 0) {
                logger.error(`Request ${requestId} not found in ${table}`)
                return
            }

            const phoneNumber = result[0].whatsapp_phone

            // Send document to user
            await this.sendDocumentNotification(
                phoneNumber,
                service,
                requestId,
                pdfPath,
                filename
            )

            // Update status in database
            await sql`
        UPDATE ${sql(table)}
        SET status = 'completed', pdf_url = ${filename}, updated_at = NOW()
        WHERE id = ${requestId}
      `

            logger.info(`✅ Request ${requestId} marked as completed`)
        } catch (error: any) {
            logger.error(`Error notifying document ready: ${error.message}`)
        }
    }
}

export const notificationService = new NotificationService()
