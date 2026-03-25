/**
 * ============================================================================
 * TEST ROUTES (HONO)
 * ============================================================================
 */

import { Hono } from 'hono'
import { databaseService } from '../services/database.service'

const testRoutes = new Hono()

/**
 * GET /test/data
 * View all stored data (dev only)
 */
testRoutes.get('/data', async (c) => {
  if (process.env.NODE_ENV === 'production') {
    return c.json({ error: 'Not available in production' }, 403)
  }

  const [users, orders, sessions] = await Promise.all([
    databaseService.getUsers(),
    databaseService.getOrders(),
    databaseService.getSessions(),
  ])

  return c.json({
    users,
    orders,
    sessions,
    stats: {
      totalUsers: users.length,
      totalOrders: orders.length,
      totalSessions: sessions.length,
      completedOrders: orders.filter((o) => o.status === 'completed').length,
      pendingOrders: orders.filter((o) => o.status === 'pending').length,
    },
  })
})

/**
 * POST /test/clear
 * Clear all data (dev only)
 */
testRoutes.post('/clear', async (c) => {
  if (process.env.NODE_ENV === 'production') {
    return c.json({ error: 'Not available in production' }, 403)
  }

  await databaseService.clearAll()
  return c.json({ message: 'All test data cleared' })
})

export default testRoutes