/**
 * ============================================================================
 * 8A MODULE CONTROLLER
 * ============================================================================
 * Handles requests for 8A land records
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

/**
 * Creates a new 8A document request.
 * 
 * Flow:
 * 1. Validates input (District, Taluka, Village, Gat No).
 * 2. Creates a record in `requests_8a` table.
 * 3. Queues the task in RabbitMQ for the Python worker.
 * 
 * @param c Hono Context
 */
export async function create8aRequest(c: Context) {
  try {
    const { district, taluka, village, gat_no, whatsapp_phone } =
      await c.req.json()

    if (!district || !taluka || !village || !gat_no || !whatsapp_phone) {
      return c.json(
        {
          error: 'Missing required fields',
        },
        400
      )
    }

    const request = await createModuleRequest('8a', {
      district,
      taluka,
      village,
      gat_no,
      whatsapp_phone,
    })

    await queueModuleTask('8a', request.id, {
      district,
      taluka,
      village,
      gat_no,
    })

    return c.json({
      success: true,
      request_id: request.id,
      status: request.status,
    })
  } catch (error) {
    console.log("============================================================");
    console.log("============================================================");
    console.error('Error in create8aRequest:', error)
    console.log("============================================================");
    console.log("============================================================");
    return c.json({ error: 'Failed to create request' }, 500)
  }
}

/**
 * Retrieves the status of a specific 8A request.
 * 
 * @param c Hono Context (params: id)
 */
export async function get8aRequestStatus(c: Context) {
  try {
    const id = parseInt(c.req.param('id'))

    if (!id) {
      return c.json({ error: 'Invalid request ID' }, 400)
    }

    const request = await getModuleRequest('8a', id)

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
    console.log("============================================================");
    console.log("============================================================");
    console.error('Error in get8aRequestStatus:', error)
    console.log("============================================================");
    console.log("============================================================");
    return c.json({ error: 'Failed to fetch request' }, 500)
  }
}

/**
 * Get user's 8A requests
 */
export async function get8aUserRequests(c: Context) {
  try {
    const phone = c.req.param('phone')

    if (!phone) {
      return c.json({ error: 'Phone number required' }, 400)
    }

    const requests = await getModuleRequestsByPhone('8a', phone)

    return c.json({
      phone,
      count: requests.length,
      requests,
    })
  } catch (error) {
    console.log("============================================================");
    console.log("============================================================");
    console.error('Error in get8aUserRequests:', error)
    console.log("============================================================");
    console.log("============================================================");
    return c.json({ error: 'Failed to fetch requests' }, 500)
  }
}

/**
 * Get aggregated statistics for the 8A module.
 * Counts total, completed, processing, and failed requests.
 */
export async function get8aStats(c: Context) {
  try {
    const stats = await getModuleStats('8a')

    return c.json({
      module: '8a',
      total: stats.total,
      completed: stats.completed,
      processing: stats.processing,
      failed: stats.failed,
    })
  } catch (error) {
    console.log("============================================================");
    console.log("============================================================");
    console.error('Error in get8aStats:', error)
    console.log("============================================================");
    console.log("============================================================");
    return c.json({ error: 'Failed to fetch stats' }, 500)
  }
}

/**
 * Initiates the payment process for an 8A document request.
 * Creates a Razorpay order associated with the request ID.
 */
export async function initiate8aPayment(c: Context) {
  try {
    const { request_id, whatsapp_phone } = await c.req.json()

    if (!request_id || !whatsapp_phone) {
      console.log("============================================================");
      console.log("============================================================");
      return c.json({ error: 'Missing required fields' }, 400)
    }

    const request = await getModuleRequest('8a', request_id)
    if (!request) {
      console.log("============================================================");
      console.log("============================================================");
      return c.json({ error: 'Request not found' }, 404)
    }

    const order = await paymentService.createOrder('8a', request_id, whatsapp_phone)

    return c.json({
      success: true,
      order_id: order.id,
      amount: order.amount,
    })
  } catch (error) {
    console.log("============================================================");
    console.log("============================================================");
    console.error('Error in initiate8aPayment:', error)
    console.log("============================================================");
    console.log("============================================================");
    return c.json({ error: 'Failed to initiate payment' }, 500)
  }
}

/**
 * Verify payment for 8A
 */

export async function verify8aPayment(c: Context) {
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

    // FIX: Remove the third argument '8a'
    await paymentService.markPaymentSuccess(
      razorpay_payment_id,
      razorpay_order_id
      // '8a'  <-- REMOVE THIS
    )

    return c.json({
      success: true,
      message: 'Payment verified',
    })
  } catch (error) {
    console.error('Error in verify8aPayment:', error)
    return c.json({ error: 'Failed to verify payment' }, 500)
  }
}
