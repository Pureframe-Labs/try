/**
 * ============================================================================
 * PAYMENT CONTROLLER
 * ============================================================================
 * 
 * Purpose:
 * Handles the payment flow for the application.
 * Renders HTML pages for the user to complete transactions via Razorpay.
 * 
 * Flow:
 * 1. User clicks payment link in WhatsApp -> `renderCheckout`
 * 2. User pays on Razorpay Gateway.
 * 3. Razorpay redirects to `handleSuccess`.
 * 4. Controller verifies signature and updates DB.
 */

import type { Context } from 'hono'
import { html } from 'hono/html'
import { sessionManager } from '../services/session-manager.service'
import { paymentService } from '../services/payment.service'
import { logger } from '../utils/logger'

class PaymentController {
  /**
   * Renders the Checkout HTML page.
   * This page contains the Razorpay JS integration to initiate the payment.
   * 
   * @param c Hono Context (query: orderId)
   */
  async renderCheckout(c: Context) {
    const orderId = c.req.query('orderId')

    if (!orderId) {
      return c.html('<h1>Error: Order ID is required</h1>')
    }

    const order = await paymentService.getOrderByRazorpayId(orderId)

    if (!order) {
      return c.html('<h1>Error: Order not found</h1>')
    }

    if (order.status === 'completed') {
      return c.html('<h1>This order has already been paid</h1>')
    }

    // FIX: Convert amount to number explicitly
    const amount = Number(order.amount) || 0
    const amountInPaisa = amount * 100

    const serviceName = `Land Record (${order.module_type})`

    const checkoutHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Checkout</title>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 500px;
      width: 100%;
      padding: 40px;
    }
    h1 { color: #333; margin-bottom: 10px; font-size: 28px; }
    .order-info {
      background: #f7f7f7;
      border-radius: 12px;
      padding: 20px;
      margin: 20px 0;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .info-row:last-child { border-bottom: none; }
    .label { color: #666; font-weight: 500; }
    .value { color: #333; font-weight: 600; }
    .amount {
      font-size: 32px;
      color: #667eea;
      text-align: center;
      margin: 20px 0;
    }
    .pay-button {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 16px 32px;
      border-radius: 12px;
      font-size: 18px;
      font-weight: 600;
      width: 100%;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .pay-button:hover { transform: translateY(-2px); }
    .pay-button:active { transform: translateY(0); }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔒 Secure Payment</h1>
    <p style="color: #666; margin-bottom: 20px;">Complete your payment to proceed</p>
    
    <div class="order-info">
      <div class="info-row">
        <span class="label">Order ID</span>
        <span class="value">${orderId}</span>
      </div>
      <div class="info-row">
        <span class="label">Service</span>
        <span class="value">${serviceName}</span>
      </div>
      <div class="info-row">
        <span class="label">Payment Method</span>
        <span class="value">Razorpay</span>
      </div>
    </div>
    
    <div class="amount">₹${amount.toFixed(2)}</div>
    
    <button id="rzp-button1" class="pay-button">
      Pay with Razorpay
    </button>
  </div>

  <script>
    var options = {
      "key": "${process.env.RZP_ID || ''}",
      "amount": "${amountInPaisa}",  // Now safe - amountInPaisa is a number
      "currency": "INR",
      "name": "Land Records Bot",
      "description": "Payment for ${serviceName}",
      "order_id": "${orderId}",
      "handler": function (response) {
        // Redirect to success page with payment details
        window.location.href = '/payment/success?orderId=${orderId}&paymentId=' + 
                               response.razorpay_payment_id + '&signature=' + 
                               response.razorpay_signature;
      },
      "prefill": {
        "contact": "${order.whatsapp_phone || ''}"
      },
      "theme": {
        "color": "#667eea"
      }
    };
    
    var rzp1 = new Razorpay(options);
    
    document.getElementById('rzp-button1').onclick = function(e) {
      rzp1.open();
      e.preventDefault();
    }
  </script>
</body>
</html>`

    return c.html(checkoutHtml)
  }

  /**
   * Handles successful payment callbacks from Razorpay.
   * 
   * Verification Logic:
   * 1. Validates presence of `paymentId` and `signature`.
   * 2. Verifies cryptographic signature using `paymentService`.
   * 3. Updates order status in DB (idempotent).
   * 4. Notifies user via WhatsApp.
   * 5. Renders Success HTML.
   * 
   * @param c Hono Context
   */
  async handleSuccess(c: Context) {
    const orderId = c.req.query('orderId')
    const paymentId = c.req.query('paymentId')
    const signature = c.req.query('signature')

    if (!orderId || !paymentId || !signature) {
      return c.html('<h1>Error: Missing payment details</h1>')
    }

    // Verify signature
    const isValid = paymentService.verifyPaymentSignature(orderId, paymentId, signature)

    if (!isValid) {
      return c.html('<h1>Error: Invalid Payment Signature</h1>')
    }

    const order = await paymentService.getOrderByRazorpayId(orderId)

    if (!order) {
      return c.html('<h1>Error: Order not found</h1>')
    }

    // Mark as successful in DB
    await paymentService.markPaymentSuccess(paymentId, orderId)

    // Notify user via WhatsApp session manager
    if (order.whatsapp_phone) {
      await sessionManager.handlePaymentSuccess(order.whatsapp_phone, orderId)
    }

    const successHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Successful</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 500px;
      width: 100%;
      padding: 40px;
      text-align: center;
    }
    .checkmark {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: #11998e;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
    }
    .checkmark::after {
      content: '✓';
      color: white;
      font-size: 50px;
    }
    h1 { color: #333; margin-bottom: 10px; }
    p { color: #666; line-height: 1.6; margin: 10px 0; }
    .order-id {
      background: #f7f7f7;
      padding: 15px;
      border-radius: 8px;
      margin: 20px 0;
      font-family: monospace;
      color: #333;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark"></div>
    <h1>Payment Successful!</h1>
    <p>Thank you for your payment.</p>
    <div class="order-id">Order ID: ${orderId}</div>
    <p>A confirmation message has been sent to your WhatsApp.</p>
    <p style="margin-top: 20px;">You can close this page now.</p>
  </div>
</body>
</html>`

    return c.html(successHtml)
  }

  /**
   * Renders the Payment Failure HTML page.
   * 
   * @param c Hono Context
   */
  async handleFailure(c: Context) {
    const orderId = c.req.query('orderId')

    if (!orderId) {
      return c.html('<h1>Error: Order ID is required</h1>')
    }

    const failureHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Failed</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 500px;
      width: 100%;
      padding: 40px;
      text-align: center;
    }
    .icon {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: #f5576c;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      color: white;
      font-size: 50px;
    }
    h1 { color: #333; margin-bottom: 10px; }
    p { color: #666; line-height: 1.6; margin: 10px 0; }
    .retry-button {
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      color: white;
      border: none;
      padding: 14px 28px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      margin-top: 20px;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">✕</div>
    <h1>Payment Failed</h1>
    <p>Unfortunately, your payment could not be processed.</p>
    <p style="margin-top: 20px;">Please try again from your WhatsApp chat.</p>
  </div>
</body>
</html>`

    return c.html(failureHtml)
  }
}

export const paymentController = new PaymentController()