/**
 * ============================================================================
 * FERFAR MODULE CONTROLLER
 * ============================================================================
 * Handles requests for Ferfar records
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
 * Creates a new Ferfar request.
 * 
 * Flow:
 * 1. Validates input.
 * 2. Persists request in DB.
 * 3. Enqueues task for the worker.
 * 
 * @param c Hono Context
 */
export async function createFerfarRequest(c: Context) {
  try {
    const { district, taluka, village, gat_no, whatsapp_phone } =
      await c.req.json()

    if (!district || !taluka || !village || !gat_no || !whatsapp_phone) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    const request = await createModuleRequest('ferfar', {
      district,
      taluka,
      village,
      gat_no,
      whatsapp_phone,
    })

    await queueModuleTask('ferfar', request.id, {
      district,
      taluka,
      village,
      gat_no,
      whatsapp_phone,
    })

    return c.json({
      success: true,
      request_id: request.id,
      status: request.status,
    })
  } catch (error) {
    console.error('Error in createFerfarRequest:', error)
    return c.json({ error: 'Failed to create request' }, 500)
  }
}

/**
 * Retrieves the status of a specific Ferfar request.
 */
export async function getFerfarRequestStatus(c: Context) {
  try {
    const id = parseInt(c.req.param('id'))

    if (!id) {
      return c.json({ error: 'Invalid request ID' }, 400)
    }

    const request = await getModuleRequest('ferfar', id)

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
    console.error('Error in getFerfarRequestStatus:', error)
    return c.json({ error: 'Failed to fetch request' }, 500)
  }
}

export async function getFerfarUserRequests(c: Context) {
  try {
    const phone = c.req.param('phone')

    if (!phone) {
      return c.json({ error: 'Phone number required' }, 400)
    }

    const requests = await getModuleRequestsByPhone('ferfar', phone)

    return c.json({
      phone,
      count: requests.length,
      requests,
    })
  } catch (error) {
    console.error('Error in getFerfarUserRequests:', error)
    return c.json({ error: 'Failed to fetch requests' }, 500)
  }
}

export async function getFerfarStats(c: Context) {
  try {
    const stats = await getModuleStats('ferfar')

    return c.json({
      module: 'ferfar',
      total: stats.total,
      completed: stats.completed,
      processing: stats.processing,
      failed: stats.failed,
    })
  } catch (error) {
    console.error('Error in getFerfarStats:', error)
    return c.json({ error: 'Failed to fetch stats' }, 500)
  }
}

export async function initiateFerfarPayment(c: Context) {
  try {
    const { request_id, whatsapp_phone } = await c.req.json()

    if (!request_id || !whatsapp_phone) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    const request = await getModuleRequest('ferfar', request_id)
    if (!request) {
      return c.json({ error: 'Request not found' }, 404)
    }

    const order = await paymentService.createOrder(
      'ferfar',
      request_id,
      whatsapp_phone
    )

    return c.json({
      success: true,
      order_id: order.id,
      amount: order.amount,
    })
  } catch (error) {
    console.error('Error in initiateFerfarPayment:', error)
    return c.json({ error: 'Failed to initiate payment' }, 500)
  }
}


export async function verifyFerfarPayment(c: Context) {
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

    // FIX: Remove the third argument 'ferfar'
    await paymentService.markPaymentSuccess(
      razorpay_payment_id,
      razorpay_order_id
      // 'ferfar'  <-- REMOVE THIS
    )

    return c.json({
      success: true,
      message: 'Payment verified',
    })
  } catch (error) {
    console.error('Error in verifyFerfarPayment:', error)
    return c.json({ error: 'Failed to verify payment' }, 500)
  }
}
