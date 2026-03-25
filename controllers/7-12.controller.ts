/**
 * ============================================================================
 * 7/12 (SATBARA) CONTROLLER
 * ============================================================================
 * 
 * Purpose:
 * Handles HTTP requests related to the 7/12 (SatBara) land record module.
 * Manages the lifecycle of a request from creation -> processing -> payment -> delivery.
 * 
 * Flow:
 * 1. User initiates request (via API or WhatsApp).
 * 2. Request is saved to DB and queued for the Worker.
 * 3. Worker updates status.
 * 4. User pays for the document.
 * 5. Document is delivered.
 */

import type { Context } from 'hono'
import {
  createModuleRequest,
  getModuleRequest,
  getModuleRequestsByPhone,
  getModuleStats,
  queueModuleTask,
} from '../services/modules.service'
import { paymentService } from '../services/payment.service'
import { sessionManager } from '../services/session-manager.service'
import { sql } from '../config/database.config'

/**
 * Creates a new 7/12 document request.
 * 
 * Flow:
 * 1. Validates input (District, Taluka, Village, Gat No).
 * 2. Creates a record in `requests_7_12` table.
 * 3. Queues the task in RabbitMQ for the Python worker.
 * 4. Returns the request ID.
 * 
 * @param c Hono Context
 */
export async function createSatbaraRequest(c: Context) {
  try {
    const { district, taluka, village, gat_no, whatsapp_phone } = await c.req.json()

    if (!district || !taluka || !village || !gat_no || !whatsapp_phone) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    // Persist request to DB
    const request = await createModuleRequest('7-12', {
      district,
      taluka,
      village,
      gat_no,
      whatsapp_phone,
    })

    // Offload scraping task to worker queue
    await queueModuleTask('7-12', request.id, {
      district,
      taluka,
      village,
      gat_no,
    })

    return c.json({
      success: true,
      request_id: request.id,
      status: "finding_file",
    })
  } catch (error) {
    console.error('Error in createSatbaraRequest:', error)
    return c.json({ error: 'Failed to create request' }, 500)
  }
}

/**
 * Retrieves the status of a specific 7/12 request.
 * Used for polling or checking progress.
 * 
 * @param c Hono Context (params: id)
 */
export async function getSatbaraRequestStatus(c: Context) {
  try {
    const id = parseInt(c.req.param('id'))

    if (!id) {
      return c.json({ error: 'Invalid request ID' }, 400)
    }

    const request = await getModuleRequest('7-12', id)

    if (!request) {
      return c.json({ error: 'Request not found' }, 404)
    }

    return c.json({
      id: request.id,
      status: request.status,
      pdf_url: request.pdf_url,
      created_at: request.created_at,
    })
  } catch (error) {
    console.error('Error in getSatbaraRequestStatus:', error)
    return c.json({ error: 'Failed to fetch request' }, 500)
  }
}



// Add this to your Hono/Express routes
export async function updateRequestStatus(c: Context) {
  const { requestId, status } = await c.req.json();

  // Update the PostgreSQL database
  await sql`
        UPDATE requests_7_12 
        SET status = ${status}, updated_at = NOW() 
        WHERE id = ${requestId}
    `;

  return c.json({ success: true });
}

export async function getSatbaraUserRequests(c: Context) {
  try {
    const phone = c.req.param('phone')

    if (!phone) {
      return c.json({ error: 'Phone number required' }, 400)
    }

    const requests = await getModuleRequestsByPhone('7-12', phone)

    return c.json({
      phone,
      count: requests.length,
      requests,
    })
  } catch (error) {
    console.error('Error in getSatbaraUserRequests:', error)
    return c.json({ error: 'Failed to fetch requests' }, 500)
  }
}

export async function getSatbaraStats(c: Context) {
  try {
    const stats = await getModuleStats('7-12')

    return c.json({
      module: '7-12',
      total: stats.total,
      completed: stats.completed,
      processing: stats.processing,
      failed: stats.failed,
    })
  } catch (error) {
    console.error('Error in getSatbaraStats:', error)
    return c.json({ error: 'Failed to fetch stats' }, 500)
  }
}

export async function initiateSatbaraPayment(c: Context) {
  try {
    const { request_id, whatsapp_phone } = await c.req.json()

    if (!request_id || !whatsapp_phone) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    const request = await getModuleRequest('7-12', request_id)
    if (!request) {
      return c.json({ error: 'Request not found' }, 404)
    }

    const order = await paymentService.createOrder(
      '7-12',
      request_id,
      whatsapp_phone
    )

    return c.json({
      success: true,
      order_id: order.id,
      amount: order.amount,
    })
  } catch (error) {
    console.error('Error in initiateSatbaraPayment:', error)
    return c.json({ error: 'Failed to initiate payment' }, 500)
  }
}

// Sending Raw PDF to the User
export async function complete712Request(c: Context) {
  try {
    const url = new URL(c.req.url, 'http://localhost:3000')
    const params = url.searchParams

    const phoneNumber = params.get('phoneNumber')
    const requestId = params.get('requestId')
    const fileName = params.get('fileName')

    console.log('✅ Complete:', { phoneNumber, requestId, fileName })

    if (!phoneNumber || !requestId || !fileName) {
      return c.text('Missing params', 400)
    }

    // DON'T construct path here - let session manager handle it
    const success = await sessionManager.sendCompletedDocument(
      phoneNumber,
      '7-12',
      parseInt(requestId),
      '',  // Empty path - session manager will construct it
      fileName
    )

    return c.text(success ? 'PDF sent' : 'Failed to send PDF')

  } catch (error: any) {
    console.error('❌ Error:', error.message)
    return c.text(`Error: ${error.message}`, 500)
  }
}




export async function verifySatbaraPayment(c: Context) {
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

    // FIX: Remove the third argument '7-12'
    await paymentService.markPaymentSuccess(
      razorpay_payment_id,
      razorpay_order_id
      // '7-12'  <-- REMOVE THIS
    )

    return c.json({
      success: true,
      message: 'Payment verified',
    })
  } catch (error) {
    console.error('Error in verifySatbaraPayment:', error)
    return c.json({ error: 'Failed to verify payment' }, 500)
  }
}
