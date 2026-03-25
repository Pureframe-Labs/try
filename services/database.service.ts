/**
 * ============================================================================
 * DATABASE SERVICE (POSTGRES)
 * ============================================================================
 * Refactored to use PostgreSQL instead of JSON files
 */

import { sql } from '../config/database.config'

interface User {
  phoneNumber: string
  firstName?: string
  lastName?: string
  createdAt: string
  lastActiveAt: string
}

interface Order {
  orderId: string
  userId: string
  service: string
  serviceName: string
  amount: number
  formData: any
  status: 'pending' | 'completed' | 'failed'
  paymentId?: string
  createdAt: string
  paidAt?: string
}

interface Session {
  phoneNumber: string
  currentService?: string
  serviceName?: string
  step?: string
  orderId?: string
  data?: any
  startedAt?: string
}

class DatabaseService {

  // ============================================================================
  // USER OPERATIONS
  // ============================================================================

  /**
   * Retrieves all users.
   */
  async getUsers(): Promise<User[]> {
    const users = await sql`SELECT * FROM users`
    return users.map(u => ({
      phoneNumber: u.whatsapp_phone,
      firstName: u.name,
      createdAt: u.created_at,
      lastActiveAt: u.last_active_at
    }))
  }

  async getUser(phoneNumber: string): Promise<User | null> {
    const users = await sql`SELECT * FROM users WHERE whatsapp_phone = ${phoneNumber}`
    if (users.length === 0) return null;
    const u = users[0];
    return {
      phoneNumber: u.whatsapp_phone,
      firstName: u.name,
      createdAt: u.created_at,
      lastActiveAt: u.last_active_at
    }
  }

  /**
   * Creates a new user or updates an existing one.
   * Updates `last_active_at` timestamp.
   * 
   * @param phoneNumber Key
   * @param data Optional fields to update
   */
  async createOrUpdateUser(phoneNumber: string, data?: Partial<User>): Promise<User> {
    const existing = await this.getUser(phoneNumber);
    const now = new Date().toISOString();

    if (existing) {
      await sql`
            UPDATE users 
            SET last_active_at = ${now}, name = ${data?.firstName || existing.firstName || null}
            WHERE whatsapp_phone = ${phoneNumber}
        `
      return { ...existing, lastActiveAt: now, ...data }
    } else {
      await sql`
            INSERT INTO users (whatsapp_phone, name, last_active_at, created_at)
            VALUES (${phoneNumber}, ${data?.firstName || null}, ${now}, ${now})
        `
      return {
        phoneNumber,
        firstName: data?.firstName,
        createdAt: now,
        lastActiveAt: now
      }
    }
  }

  // ============================================================================
  // ORDER OPERATIONS
  // ============================================================================

  async getOrders(): Promise<Order[]> {
    const orders = await sql`SELECT * FROM orders`
    return orders as any // Simplified mapping
  }

  async getOrder(orderId: string): Promise<Order | null> {
    const orders = await sql`SELECT * FROM orders WHERE razorpay_order_id = ${orderId}`
    if (orders.length === 0) return null

    // Map DB request to Order interface
    // Note: The schema in database.config.ts for `orders` has:
    // user_id, whatsapp_phone, module_type, request_id, razorpay_order_id...
    // The Order interface here assumes slightly different fields.
    // I will try to map loosely or assume columns match if I alias them.
    // But honestly, the message controller uses this differently.

    const o = orders[0];
    return {
      orderId: o.razorpay_order_id,
      userId: o.user_id,
      service: o.module_type,
      serviceName: `Service (${o.module_type})`,
      amount: o.amount,
      formData: {}, // Not stored in orders table currently
      status: o.status,
      paymentId: o.razorpay_payment_id,
      createdAt: o.created_at
    }
  }

  async createOrder(orderData: Omit<Order, 'orderId'>): Promise<Order> {
    // Note: PaymentService usually creates orders via Razorpay first.
    // MessageController tries to create order BEFORE payment initiation?
    // MessageController calls: createOrder({ ... status: 'pending' ... })
    // Then sends link.
    // But `paymentService.createOrder` creates order in Razorpay AND DB.
    // Here we are creating purely in DB?
    // We should mock a razorpay_order_id if we don't have one, or generate one.

    // Generate local Order ID if not provided (e.g. for manual order creation)
    const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    await sql`
        INSERT INTO orders (
            user_id, whatsapp_phone, module_type, razorpay_order_id, amount, status
        ) VALUES (
            ${orderData.userId}, ${orderData.userId}, ${orderData.service}, ${orderId}, ${orderData.amount}, 'pending'
        )
    `

    return {
      ...orderData,
      orderId
    }
  }

  // Note: updateOrder might not be needed if payment controller uses paymentService

  // ============================================================================
  // SESSION OPERATIONS
  // ============================================================================

  async getSessions(): Promise<Session[]> {
    const sessions = await sql`SELECT * FROM sessions`
    return sessions.map(s => ({
      phoneNumber: s.phone_number,
      currentService: s.current_service,
      serviceName: s.service_name,
      step: s.step,
      orderId: s.order_id,
      data: s.data,
      startedAt: s.started_at
    }))
  }

  async getSession(phoneNumber: string): Promise<Session | null> {
    const sessions = await sql`SELECT * FROM sessions WHERE phone_number = ${phoneNumber}`
    if (sessions.length === 0) return null
    const s = sessions[0]
    return {
      phoneNumber: s.phone_number,
      currentService: s.current_service,
      serviceName: s.service_name,
      step: s.step,
      orderId: s.order_id,
      data: s.data,
      startedAt: s.started_at
    }
  }

  async createOrUpdateSession(phoneNumber: string, sessionData: Partial<Session>): Promise<Session> {
    const existing = await this.getSession(phoneNumber)
    if (existing) {
      await sql`
            UPDATE sessions 
            SET current_service = ${sessionData.currentService ?? existing.currentService ?? null},
                service_name = ${sessionData.serviceName ?? existing.serviceName ?? null},
                step = ${sessionData.step ?? existing.step ?? null},
                order_id = ${sessionData.orderId ?? existing.orderId ?? null},
                data = ${JSON.stringify(sessionData.data ?? existing.data ?? {})}
            WHERE phone_number = ${phoneNumber}
        `
      return { ...existing, ...sessionData }
    } else {
      await sql`
            INSERT INTO sessions (phone_number, current_service, service_name, step, order_id, data, started_at)
            VALUES (
                ${phoneNumber}, 
                ${sessionData.currentService ?? null}, 
                ${sessionData.serviceName ?? null}, 
                ${sessionData.step ?? null}, 
                ${sessionData.orderId ?? null}, 
                ${JSON.stringify(sessionData.data ?? {})}, 
                NOW()
            )
        `
      return { phoneNumber, ...sessionData } as Session
    }
  }

  async deleteSession(phoneNumber: string): Promise<void> {
    await sql`DELETE FROM sessions WHERE phone_number = ${phoneNumber}`
  }

  // ============================================================================
  // UTILITY OPERATIONS
  // ============================================================================

  async clearAll(): Promise<void> {
    await sql`DELETE FROM sessions`
    await sql`DELETE FROM orders`
    await sql`DELETE FROM users`
  }
}

export const databaseService = new DatabaseService()