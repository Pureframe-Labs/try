/**
 * ============================================================================
 * PAYMENT SERVICE
 * ============================================================================
 * 
 * Purpose:
 * Abstraction layer for Razorpay integration.
 * Handles order creation, logic for price calculation, and signature verification.
 */

import Razorpay from 'razorpay'
import crypto from 'crypto'
import { sql } from '../config/database.config'

const razorpay = new Razorpay({
    key_id: process.env.RZP_ID || '',
    key_secret: process.env.RZP_SECRET || '',
})

export class PaymentService {
    /**
     * Creates a new Order in Razorpay and persists it to the local DB.
     * 
     * @param moduleType Service type (7-12, 8a, etc.)
     * @param requestId Database ID of the request
     * @param whatsappPhone User's phone number
     * @returns Razorpay Order Object
     */
    async createOrder(moduleType: string, requestId: number, whatsappPhone: string) {
        // FIX: Get price from config and ensure it's a number
        const { paymentConfig } = await import('../config/payment.config')
        const priceMap: Record<string, number> = {
            '7-12': paymentConfig.formPrices['7-12'],
            '8a': paymentConfig.formPrices['8a'],
            'property-card': paymentConfig.formPrices['property-card'],
            'ferfar': paymentConfig.formPrices.ferfar
        }

        // Ensure amount is a number and convert to paise (multiply by 100)
        const amountInRupees = Number(priceMap[moduleType]) || 20 // Default to 20 if not found
        const amountInPaisa = amountInRupees * 100

        // Receipt needs to be shortish
        const receipt = `rcpt_${moduleType}_${requestId}_${Date.now()}`.substring(0, 40);

        const options = {
            amount: amountInPaisa, // Now definitely a number
            currency: 'INR',
            receipt: receipt,
            notes: {
                module: moduleType,
                request_id: requestId,
                phone: whatsappPhone
            }
        }

        try {
            console.log(`💰 Creating Razorpay order for ${moduleType} request ${requestId} - Amount: ₹${amountInRupees}`);
            const order = await razorpay.orders.create(options)

            // Save order to DB (store amount in rupees, not paise)
            await sql`
        INSERT INTO orders (
          user_id, whatsapp_phone, module_type, request_id, 
          razorpay_order_id, amount, status
        ) VALUES (
          ${whatsappPhone}, ${whatsappPhone}, ${moduleType}, ${requestId},
          ${order.id}, ${amountInRupees}, 'pending'
        )
      `

            return order
        } catch (error) {
            console.error('Razorpay Error:', error)
            throw error
        }
    }

    /**
     * Verifies the authenticity of a Razorpay payment via HMAC signature.
     * Essential security step to prevent tampering.
     * 
     * @param orderId Razorpay Order ID
     * @param paymentId Razorpay Payment ID
     * @param signature Returned Signature
     */
    verifyPaymentSignature(orderId: string, paymentId: string, signature: string) {
        const secret = process.env.RZP_SECRET || ''
        const generated_signature = crypto
            .createHmac('sha256', secret)
            .update(orderId + '|' + paymentId)
            .digest('hex')

        return generated_signature === signature
    }

    /**
     * Updates the local database to mark an order and request as PAID.
     * 
     * Actions:
     * 1. Updates specific request table (e.g., requests_7_12).
     * 2. Updates orders table.
     */
    async markPaymentSuccess(paymentId: string, razorpayOrderId: string): Promise<boolean> {
        try {
            const order = await this.getOrderByRazorpayId(razorpayOrderId);
            if (!order) return false;

            // FIX: Add all module types to the table map
            const tableMap: Record<string, string> = {
                '7-12': 'requests_7_12',
                '8a': 'requests_8a',
                'property-card': 'requests_property_card',
                'ferfar': 'requests_ferfar'
            };

            const tableName = tableMap[order.module_type];
            if (!tableName) {
                console.error(`Unknown module type: ${order.module_type}`);
                return false;
            }

            // 1. Update the specific request table to 'paid' 
            await sql`
            UPDATE ${sql(tableName)}
            SET status = 'paid', payment_id = ${paymentId}, updated_at = NOW()
            WHERE id = ${order.request_id}
        `;

            // 2. Update the main orders table
            await sql`
            UPDATE orders 
            SET status = 'completed', razorpay_payment_id = ${paymentId}, updated_at = NOW()
            WHERE razorpay_order_id = ${razorpayOrderId}
        `;

            console.log(`✅ Payment successful for order ${razorpayOrderId}, request ${order.request_id} (${order.module_type})`);
            return true;
        } catch (error) {
            console.error('Database update failed:', error);
            return false;
        }
    }

    /**
     * Get order details by Razorpay Order ID
     */
    async getOrderByRazorpayId(razorpayOrderId: string) {
        try {
            const result = await sql`
        SELECT * FROM orders WHERE razorpay_order_id = ${razorpayOrderId}
      `
            if (result.length === 0) return null

            // FIX: Ensure amount is a number when returned
            const order = result[0]
            if (order.amount) {
                order.amount = Number(order.amount)
            }

            return order
        } catch (error) {
            console.error('DB Error getting order:', error)
            return null
        }
    }
}

export const paymentService = new PaymentService()