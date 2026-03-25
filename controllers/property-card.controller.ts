/**
 * ============================================================================
 * PROPERTY CARD MODULE CONTROLLER
 * ============================================================================
 * 
 * Purpose:
 * Handles requests specifically for the Property Card (Malmatta Patrak) module.
 * 
 * Distinguished from other modules by:
 * - Specific fields: region, office, cts_no.
 * - Separate database table: `requests_property_card`.
 */

import type { Context } from 'hono'
import { sql } from '../config/database.config'
import { paymentService } from '../services/payment.service'
import { sessionManager } from '../services/session-manager.service'
import { logger } from '../utils/logger'
import path from 'path'

// ============================================================================
// REQUEST CREATION
// ============================================================================

/**
 * Creates a new Property Card request.
 * 
 * @param c Hono Context
 */
export async function createPropertyCardRequest(c: Context) {
  try {
    const { region, district, office, village, cts_no, whatsapp_phone } = await c.req.json()

    // Validate required fields
    if (!region || !district || !office || !village || !cts_no || !whatsapp_phone) {
      return c.json({
        error: 'Missing required fields',
        required: ['region', 'district', 'office', 'village', 'cts_no', 'whatsapp_phone']
      }, 400)
    }

    // Insert into database
    const result = await sql`
      INSERT INTO requests_property_card 
      (region, district, office, village, cts_no, whatsapp_phone, status)
      VALUES (${region}, ${district}, ${office}, ${village}, ${cts_no}, ${whatsapp_phone}, 'pending')
      RETURNING id, status, created_at
    `

    const request = result[0]

    logger.info(`✅ Property Card request created: ${request.id} for ${whatsapp_phone}`)

    return c.json({
      success: true,
      request_id: request.id,
      status: request.status,
      created_at: request.created_at,
      message: 'Property Card request created successfully'
    })
  } catch (error) {
    logger.error('Error in createPropertyCardRequest:', error)
    return c.json({ error: 'Failed to create request' }, 500)
  }
}

// ============================================================================
// STATUS CHECKING
// ============================================================================

/**
 * Retrieves status of a Property Card request.
 * 
 * @param c Hono Context (params: id)
 */
export async function getPropertyCardRequestStatus(c: Context) {
  try {
    const id = parseInt(c.req.param('id'))

    if (isNaN(id)) {
      return c.json({ error: 'Invalid request ID' }, 400)
    }

    const result = await sql`
      SELECT id, status, pdf_url, created_at, updated_at
      FROM requests_property_card 
      WHERE id = ${id}
    `

    if (result.length === 0) {
      return c.json({ error: 'Request not found' }, 404)
    }

    return c.json({
      success: true,
      ...result[0]
    })
  } catch (error) {
    logger.error('Error in getPropertyCardRequestStatus:', error)
    return c.json({ error: 'Failed to fetch request' }, 500)
  }
}

// ============================================================================
// USER REQUESTS
// ============================================================================

/**
 * Lists recent Property Card requests for a specific phone number.
 * Limited to last 50 requests.
 * 
 * @param c Hono Context (params: phone)
 */
export async function getPropertyCardUserRequests(c: Context) {
  try {
    const phone = c.req.param('phone')

    if (!phone) {
      return c.json({ error: 'Phone number required' }, 400)
    }

    const results = await sql`
      SELECT id, status, pdf_url, created_at
      FROM requests_property_card
      WHERE whatsapp_phone = ${phone}
      ORDER BY created_at DESC
      LIMIT 50
    `

    return c.json({
      success: true,
      phone,
      count: results.length,
      requests: results
    })
  } catch (error) {
    logger.error('Error in getPropertyCardUserRequests:', error)
    return c.json({ error: 'Failed to fetch requests' }, 500)
  }
}

// ============================================================================
// STATISTICS
// ============================================================================

export async function getPropertyCardStats(c: Context) {
  try {
    const result = await sql`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
        COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled
      FROM requests_property_card
    `

    return c.json({
      success: true,
      module: 'property-card',
      ...result[0]
    })
  } catch (error) {
    logger.error('Error in getPropertyCardStats:', error)
    return c.json({ error: 'Failed to fetch stats' }, 500)
  }
}

// ============================================================================
// PAYMENT INITIATION
// ============================================================================

export async function initiatePropertyCardPayment(c: Context) {
  try {
    const { request_id, whatsapp_phone } = await c.req.json()

    if (!request_id || !whatsapp_phone) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    // Verify request exists and is in correct state
    const request = await sql`
      SELECT id, status FROM requests_property_card 
      WHERE id = ${request_id} AND whatsapp_phone = ${whatsapp_phone}
    `

    if (request.length === 0) {
      return c.json({ error: 'Request not found' }, 404)
    }

    if (request[0].status !== 'pending' && request[0].status !== 'pdf_verified') {
      return c.json({ error: `Cannot initiate payment for request with status: ${request[0].status}` }, 400)
    }

    // Create Razorpay order
    const order = await paymentService.createOrder('property-card', request_id, whatsapp_phone)

    // FIX: Convert amount to number with fallback
    const amountInPaisa = Number(order.amount) || 0
    const amountInRupees = amountInPaisa / 100

    // Update request with payment info
    await sql`
      UPDATE requests_property_card 
      SET payment_id = ${order.id}, status = 'payment_initiated', updated_at = NOW()
      WHERE id = ${request_id}
    `

    return c.json({
      success: true,
      order_id: order.id,
      amount: amountInRupees, // Now safely converted
      currency: 'INR'
    })
  } catch (error) {
    logger.error('Error in initiatePropertyCardPayment:', error)
    return c.json({ error: 'Failed to initiate payment' }, 500)
  }
}

// ============================================================================
// PAYMENT VERIFICATION
// ============================================================================

export async function verifyPropertyCardPayment(c: Context) {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = await c.req.json()

    const isValid = paymentService.verifyPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    )

    if (!isValid) {
      return c.json({ error: 'Payment verification failed' }, 401)
    }

    // FIX: Remove the third argument 'property-card'
    await paymentService.markPaymentSuccess(
      razorpay_payment_id,
      razorpay_order_id
      // 'property-card'  <-- REMOVE THIS
    )

    return c.json({
      success: true,
      message: 'Payment verified',
    })
  } catch (error) {
    console.error('Error in verifyPropertyCardPayment:', error)
    return c.json({ error: 'Failed to verify payment' }, 500)
  }
}


// ============================================================================
// WEBHOOK FOR WORKER COMPLETION
// ============================================================================

/**
 * Callback endpoint for Worker -> Backend communication.
 * 
 * Actions:
 * 1. Updates request status (e.g., 'completed', 'failed').
 * 2. If valid PDF URL provided, triggers WhatsApp delivery via `sessionManager`.
 * 
 * @param c Hono Context
 */
export async function propertyCardComplete(c: Context) {
  try {
    const { request_id, status, pdf_url } = await c.req.json()

    if (!request_id || !status) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    // Get phone number
    const result = await sql`
      SELECT whatsapp_phone FROM requests_property_card WHERE id = ${request_id}
    `

    if (result.length === 0) {
      return c.json({ error: 'Request not found' }, 404)
    }

    const phoneNumber = result[0].whatsapp_phone

    if (status === 'completed' && pdf_url) {
      // Send document via WhatsApp
      const pdfPath = path.join(process.cwd(), 'downloads', 'property_card', pdf_url)

      const sent = await sessionManager.sendCompletedDocument(
        phoneNumber,
        'property-card',
        request_id,
        pdfPath,
        pdf_url
      )

      if (!sent) {
        throw new Error('Failed to send document')
      }
    } else {
      // Just update status
      await sql`
        UPDATE requests_property_card
        SET status = ${status}, updated_at = NOW()
        WHERE id = ${request_id}
      `
    }

    return c.json({ success: true })
  } catch (error) {
    logger.error('Error in propertyCardComplete:', error)
    return c.json({ error: 'Failed to process completion' }, 500)
  }
}