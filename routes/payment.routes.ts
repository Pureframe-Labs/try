/**
 * ============================================================================
 * PAYMENT ROUTES (HONO)
 * ============================================================================
 */

import { Hono } from 'hono'
import { paymentController } from '../controllers/payment.controller'

const paymentRoutes = new Hono()

/**
 * GET /payment/checkout?orderId=XXX
 * Display payment page
 */
paymentRoutes.get('/checkout', paymentController.renderCheckout)

/**
 * GET /payment/success?orderId=XXX&paymentId=YYY
 * Handle successful payment
 */
paymentRoutes.get('/success', paymentController.handleSuccess)

/**
 * GET /payment/failure?orderId=XXX
 * Handle failed payment
 */
paymentRoutes.get('/failure', paymentController.handleFailure)

export default paymentRoutes