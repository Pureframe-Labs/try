/**
 * ============================================================================
 * UNIFIED MODULES SERVICE
 * ============================================================================
 * 
 * Purpose:
 * Central service for managing land record requests across all modules
 * (7/12, 8A, Property Card, Ferfar).
 * 
 * Responsibilities:
 * 1. CRUD operations for Request tables in PostgreSQL.
 * 2. RabbitMQ integration for offloading scraping tasks to workers.
 * 3. Connection management and retry logic for the message queue.
 */

import { sql } from '../config/database.config'
import type { Context } from 'hono'
import amqp from 'amqplib'

export type ModuleType = '7-12' | '8a' | 'property-card' | 'ferfar'

// Standardized interface for incoming request data
export interface ModuleRequest {
  district: string
  taluka?: string        // Optional for Property Card
  village: string
  gat_no: string         // Acts as 'cts_no' for Property Card, 'mutation_no' for Ferfar
  sheet_no?: string      // Specific to 7/12
  whatsapp_phone: string
  payment_id?: string
  // Property Card specific fields
  region?: string
  office?: string
}

// ============================================================================
// RABBITMQ SETUP WITH RECONNECTION
// ============================================================================

let channel: amqp.Channel | null = null
let connection: any = null  // Use 'any' to avoid type issues

// In initRabbitMQWithRetry function, update queue declarations
/**
 * Initializes RabbitMQ connection with auto-retry logic.
 * Ensures all necessary queues are asserted (created) before use.
 * 
 * Queues:
 * - 7_12_queue
 * - 8a_queue
 * - propert_card_queue
 * - ferfar_queue
 */
async function initRabbitMQWithRetry() {
  while (!channel) {
    try {
      const mqUrl = process.env.RABBITMQ_URL || 'amqp://localhost'
      connection = await amqp.connect(mqUrl)

      connection.on('close', () => {
        console.log('⚠️  RabbitMQ connection closed. Reconnecting...')
        channel = null
        connection = null
        setTimeout(initRabbitMQWithRetry, 3000)
      })

      connection.on('error', (err: Error) => {
        console.log('⚠️  RabbitMQ connection error:', err.message)
        channel = null
        connection = null
        setTimeout(initRabbitMQWithRetry, 3000)
      })

      channel = await connection.createChannel()

      // Declare ALL queues with consistent naming and durability
      await channel!.assertQueue('8a_queue', { durable: true });
      await channel!.assertQueue('ferfar_queue', { durable: true });
      await channel!.assertQueue('7_12_queue', { durable: true });
      await channel!.assertQueue('property_card_queue', { durable: true });

      console.log('✅ RabbitMQ Connected - Queues: 8a_queue, ferfar_queue, 7_12_queue, property_card_queue')
      return
    } catch (error) {
      console.log('⏳ Waiting for RabbitMQ to be ready...')
      await new Promise(res => setTimeout(res, 3000))
    }
  }
}

// Start connection process immediately
initRabbitMQWithRetry()

/**
 * Create a new request for a specific module
 */
export async function createModuleRequest(
  moduleType: ModuleType,
  data: ModuleRequest
) {
  try {
    const table = `requests_${moduleType.replace('-', '_')}`

    // 7-12 and property-card modules have sheet_no, others don't
    const hasSheetNo = moduleType === '7-12' || moduleType === 'property-card'

    // Property Card also needs region and office
    const isPropertyCard = moduleType === 'property-card'

    let result
    if (isPropertyCard) {
      // Property Card has additional fields
      result = await sql`
        INSERT INTO ${sql(table)} 
        (region, district, office, village, cts_no, whatsapp_phone, payment_id, status)
        VALUES (${data.region || null}, ${data.district}, ${data.office || null}, ${data.village}, 
                ${data.gat_no}, ${data.whatsapp_phone}, ${data.payment_id || null}, 'processing')
        RETURNING *
      `
    } else if (hasSheetNo) {
      result = await sql`
        INSERT INTO ${sql(table)} 
        (district, taluka, village, gat_no, sheet_no, whatsapp_phone, payment_id, status)
        VALUES (${data.district}, ${data.taluka || null}, ${data.village}, ${data.gat_no}, 
                ${data.sheet_no || null}, ${data.whatsapp_phone}, ${data.payment_id || null}, 'processing')
        RETURNING *
      `
    } else {
      result = await sql`
        INSERT INTO ${sql(table)} 
        (district, taluka, village, gat_no, whatsapp_phone, payment_id, status)
        VALUES (${data.district}, ${data.taluka || null}, ${data.village}, ${data.gat_no}, 
                ${data.whatsapp_phone}, ${data.payment_id || null}, 'processing')
        RETURNING *
      `
    }

    return result[0]
  } catch (error) {
    console.error(`Error creating ${moduleType} request:`, error)
    throw error
  }
}
/**
 * Get request by ID
 */
export async function getModuleRequest(moduleType: ModuleType, id: number) {
  try {
    const table = `requests_${moduleType.replace('-', '_')}`

    const result = await sql`
      SELECT * FROM ${sql(table)} WHERE id = ${id}
    `

    return result[0] || null
  } catch (error) {
    console.error(`Error fetching ${moduleType} request:`, error)
    throw error
  }
}

/**
 * Update request status
 */
export async function updateModuleRequestStatus(
  moduleType: ModuleType,
  id: number,
  status: 'processing' | 'completed' | 'failed',
  pdfUrl?: string
) {
  try {
    const table = `requests_${moduleType.replace('-', '_')}`

    const result = await sql`
      UPDATE ${sql(table)} 
      SET status = ${status}, pdf_url = ${pdfUrl || null}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING *
    `

    return result[0]
  } catch (error) {
    console.error(`Error updating ${moduleType} request:`, error)
    throw error
  }
}

/**
 * Get all requests for a module
 */
export async function getAllModuleRequests(moduleType: ModuleType, limit = 100) {
  try {
    const table = `requests_${moduleType.replace('-', '_')}`

    const result = await sql`
      SELECT * FROM ${sql(table)}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `

    return result
  } catch (error) {
    console.error(`Error fetching all ${moduleType} requests:`, error)
    throw error
  }
}

/**
 * Get requests by phone number
 */
export async function getModuleRequestsByPhone(
  moduleType: ModuleType,
  phone: string
) {
  try {
    const table = `requests_${moduleType.replace('-', '_')}`

    const result = await sql`
      SELECT * FROM ${sql(table)}
      WHERE whatsapp_phone = ${phone}
      ORDER BY created_at DESC
    `

    return result
  } catch (error) {
    console.error(`Error fetching ${moduleType} requests for phone:`, error)
    throw error
  }
}

/**
 * Get request statistics for a module
 */
export async function getModuleStats(moduleType: ModuleType) {
  try {
    const table = `requests_${moduleType.replace('-', '_')}`

    const result = await sql`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
      FROM ${sql(table)}
    `

    return result[0]
  } catch (error) {
    console.error(`Error fetching ${moduleType} stats:`, error)
    throw error
  }
}

/**
 * Delete old requests (older than days)
 */
export async function deleteOldModuleRequests(moduleType: ModuleType, days = 30) {
  try {
    const table = `requests_${moduleType.replace('-', '_')}`

    const result = await sql`
      DELETE FROM ${sql(table)}
      WHERE created_at < NOW() - INTERVAL '${days} days'
    `

    return result.count
  } catch (error) {
    console.error(`Error deleting old ${moduleType} requests:`, error)
    throw error
  }
}



/**
 * Enqueues a scraping task for the background worker.
 * Handles specific payload formatting for each module type.
 * Includes channel readiness verification and basic retry.
 * 
 * @param moduleType Target module (7-12, 8a, etc.)
 * @param requestId Database ID of the request
 * @param data Request data (district, village, etc.)
 */
export async function queueModuleTask(
  moduleType: ModuleType,
  requestId: number,
  data: any
) {
  try {
    // Check if channel is ready
    if (!channel) {
      console.warn(`⚠️  RabbitMQ not ready yet, retrying in 1 second...`)
      await new Promise(res => setTimeout(res, 1000))
      return queueModuleTask(moduleType, requestId, data) // Retry
    }

    // For 8a module
    if (moduleType === '8a') {
      const taskPayload = {
        id: requestId,
        doc_type: '8a',
        district: data.district,
        taluka: data.taluka,
        village: data.village,
        gat_no: data.gat_no,
      }

      try {
        channel.sendToQueue(
          '8a_queue',
          Buffer.from(JSON.stringify(taskPayload)),
          { persistent: true }
        )

        console.log(`📤 Task queued for 8a - Request ID: ${requestId}`)
        return { success: true, requestId, moduleType, queue: '8a_queue' }
      } catch (sendError) {
        console.error(`❌ Failed to send to 8a queue:`, sendError)
        channel = null
        await new Promise(res => setTimeout(res, 1000))
        return queueModuleTask(moduleType, requestId, data)
      }
    }

    // For ferfar module
    if (moduleType === 'ferfar') {
      if (!channel) {
        console.warn("⚠️  RabbitMQ not ready yet, retrying...");
        await new Promise(res => setTimeout(res, 1000));
        return queueModuleTask(moduleType, requestId, data);
      }

      const taskPayload = {
        id: requestId,
        doc_type: 'ferfar',
        district: data.district,
        taluka: data.taluka,
        village: data.village,
        mutation_no: data.gat_no,
        gat_no: data.gat_no,
        whatsapp_phone: data.whatsapp_phone
      };

      try {
        channel.sendToQueue(
          'ferfar_queue',
          Buffer.from(JSON.stringify(taskPayload)),
          { persistent: true }
        );
        console.log(`📤 Task queued for ferfar - Request ID: ${requestId}`);
        return { success: true, requestId, moduleType, queue: 'ferfar_queue' };
      } catch (sendError) {
        console.error("❌ Failed to send to ferfar queue:", sendError);
        channel = null;
        await new Promise(res => setTimeout(res, 1000));
        return queueModuleTask(moduleType, requestId, data);
      }
    }

    // For 7-12 module
    if (moduleType === '7-12') {
      if (!channel) {
        console.warn("⚠️  RabbitMQ not ready yet, retrying...");
        await new Promise(res => setTimeout(res, 1000));
        return queueModuleTask(moduleType, requestId, data);
      }

      const taskPayload = {
        id: requestId,
        doc_type: '7_12',
        district: data.district,
        taluka: data.taluka,
        village: data.village,
        gat_no: data.gat_no,
        sheet_no: data.sheet_no || null,
      };

      try {
        channel.sendToQueue(
          '7_12_queue',
          Buffer.from(JSON.stringify(taskPayload)),
          { persistent: true }
        );
        console.log(`📤 Task queued for 7-12 - Request ID: ${requestId}`);
        return { success: true, requestId, moduleType, queue: '7_12_queue' };
      } catch (sendError) {
        console.error("❌ Failed to send to 7-12 queue:", sendError);
        channel = null;
        await new Promise(res => setTimeout(res, 1000));
        return queueModuleTask(moduleType, requestId, data);
      }
    }

    // ADD THIS: For property-card module
    if (moduleType === 'property-card') {
      if (!channel) {
        console.warn("⚠️  RabbitMQ not ready yet, retrying...");
        await new Promise(res => setTimeout(res, 1000));
        return queueModuleTask(moduleType, requestId, data);
      }

      // Property Card requires specific fields: region, office, cts_no
      const taskPayload = {
        id: requestId,
        doc_type: 'property_card',  // This matches what worker expects
        region: data.region,
        district: data.district,
        office: data.office,
        village: data.village,
        cts_no: data.gat_no,  // Property Card uses cts_no instead of gat_no
        whatsapp_phone: data.whatsapp_phone
      };

      try {
        channel.sendToQueue(
          'property_card_queue',
          Buffer.from(JSON.stringify(taskPayload)),
          { persistent: true }
        );
        console.log(`📤 Task queued for property-card - Request ID: ${requestId}`);
        return { success: true, requestId, moduleType, queue: 'property_card_queue' };
      } catch (sendError) {
        console.error("❌ Failed to send to property-card queue:", sendError);
        channel = null;
        await new Promise(res => setTimeout(res, 1000));
        return queueModuleTask(moduleType, requestId, data);
      }
    }

    // For other modules (fallback)
    console.log(`Queued task for ${moduleType} - Request ID: ${requestId}`)
    return { success: true, requestId, moduleType }
  } catch (error) {
    console.error(`Error queuing ${moduleType} task:`, error)
    throw error
  }
}

export const modulesService = {
  createModuleRequest,
  getModuleRequest,
  updateModuleRequestStatus,
  getAllModuleRequests,
  getModuleRequestsByPhone,
  getModuleStats,
  deleteOldModuleRequests,
  queueModuleTask,
  initRabbitMQWithRetry
}