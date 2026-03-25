/**
 * ============================================================================
 * DATABASE CONFIGURATION
 * ============================================================================
 * 
 * Purpose:
 * Centralized database connection and schema management for the application.
 * Uses `postgres.js` for high-performance, safe SQL queries.
 * 
 * Responsibilities:
 * 1. Establishes connection to PostgreSQL.
 * 2. Defines the database schema (Tables: requests_*, users, sessions, orders).
 * 3. Handles schema migrations.
 * 4. Provides utility functions for health checks and stats.
 */

import postgres from 'postgres'

// Load environment variables for database connection
const DB_HOST = process.env.DB_HOST
const DB_PORT = process.env.DB_PORT
const DB_NAME = process.env.DB_NAME
const DB_USER = process.env.DB_USER
const DB_PASSWORD = process.env.DB_PASSWORD
const DATABASE_URL = process.env.DATABASE_URL

// Database connection validation
const connectionString = DATABASE_URL || `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`

if (!DATABASE_URL && (!DB_HOST || !DB_PORT || !DB_NAME || !DB_USER || !DB_PASSWORD)) {
  console.error('❌ FATAL: Database configuration is incomplete.')
  console.error('   Please provide DATABASE_URL or all DB_* variables in your .env file.')
  // We don't exit here to allow the app to potentially start other services, 
  // but individual queries will fail gracefully.
}

/**
 * PostgreSQL Client Instance.
 */
export const sql = postgres(
  connectionString,
  {
    onnotice: () => { }, // Suppress notice logs
    connect_timeout: 30, // 30s connection timeout
    max: 10 // Connection pool size to handle concurrent requests
  }
)

/**
 * Initializes the database schema.
 * Creates necessary tables if they do not exist.
 * 
 * Tables:
 * - requests_*: Stores user requests for specific document types.
 * - users: Stores registered user information.
 * - sessions: Stores conversational state for the WhatsApp bot.
 * - orders: Stores payment transaction details.
 */
export async function initializeDatabase() {
  try {
    console.log("============================================================")
    console.log("============================================================")
    console.log('⏳ Initializing Database...')
    console.log("============================================================")
    console.log("============================================================")

    /**
     * MODULE: 7/12 (SatBara)
     * Stores requests for 7/12 land records.
     */
    await sql`
      CREATE TABLE IF NOT EXISTS requests_7_12 (
        id SERIAL PRIMARY KEY,
        district TEXT NOT NULL,
        taluka TEXT NOT NULL,
        village TEXT NOT NULL,
        gat_no TEXT NOT NULL,
        sheet_no TEXT,
        whatsapp_phone TEXT,
        status TEXT DEFAULT 'pending_payment',
        pdf_url TEXT,
        payment_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `

    // 8A Module - Requests Table
    await sql`
      CREATE TABLE IF NOT EXISTS requests_8a (
        id SERIAL PRIMARY KEY,
        district TEXT NOT NULL,
        taluka TEXT NOT NULL,
        village TEXT NOT NULL,
        gat_no TEXT NOT NULL,
        whatsapp_phone TEXT,
        status TEXT DEFAULT 'pending_payment',
        pdf_url TEXT,
        payment_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `

    // Property Card Module - Requests Table
    await sql`
      CREATE TABLE IF NOT EXISTS requests_property_card (
        id SERIAL PRIMARY KEY,
        district TEXT NOT NULL,
        taluka TEXT NOT NULL,
        village TEXT NOT NULL,
        gat_no TEXT NOT NULL,
        whatsapp_phone TEXT,
        status TEXT DEFAULT 'pending_payment',
        pdf_url TEXT,
        payment_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `

    // Ferfar Module - Requests Table
    await sql`
      CREATE TABLE IF NOT EXISTS requests_ferfar (
        id SERIAL PRIMARY KEY,
        district TEXT NOT NULL,
        taluka TEXT NOT NULL,
        village TEXT NOT NULL,
        gat_no TEXT NOT NULL,
        whatsapp_phone TEXT,
        status TEXT DEFAULT 'pending_payment',
        pdf_url TEXT,
        payment_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `

    // Users Table
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        whatsapp_phone TEXT UNIQUE NOT NULL,
        name TEXT,
        state TEXT,
        user_id TEXT UNIQUE,
        last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `

    // Sessions Table - FIXED: Added id as primary key, phone_number as unique
    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        phone_number TEXT UNIQUE NOT NULL,
        current_service TEXT,
        service_name TEXT,
        step TEXT,
        order_id TEXT,
        request_id INTEGER,
        menu_offset INTEGER DEFAULT 0,
        data JSONB DEFAULT '{}'::jsonb,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `

    // Orders/Payments Table
    await sql`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        whatsapp_phone TEXT NOT NULL,
        module_type TEXT NOT NULL,
        request_id INTEGER,
        razorpay_order_id TEXT UNIQUE,
        razorpay_payment_id TEXT UNIQUE,
        amount DECIMAL(10, 2) NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `

    // Add indexes for better performance
    await sql`
      CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phone_number)
    `
    await sql`
      CREATE INDEX IF NOT EXISTS idx_orders_razorpay_id ON orders(razorpay_order_id)
    `
    await sql`
      CREATE INDEX IF NOT EXISTS idx_requests_phone ON requests_7_12(whatsapp_phone)
    `
    await sql`
      CREATE INDEX IF NOT EXISTS idx_requests_status ON requests_7_12(status)
    `

    console.log("============================================================")
    console.log("============================================================")
    console.log('✅ All Database Tables Created Successfully')
    console.log("============================================================")
    console.log("============================================================")
    return true
  } catch (error) {
    console.log("============================================================")
    console.log("============================================================")
    console.error('❌ Database Initialization Error:', error)
    console.log("============================================================")
    console.log("============================================================")
    throw error
  }
}

/**
 * Test database connection
 */
export async function testDatabaseConnection() {
  try {
    const result = await sql`SELECT NOW() as time`
    console.log("============================================================")
    console.log("============================================================")
    console.log('✅ Database Connection Successful')
    console.log("============================================================")
    console.log("============================================================")
    return true
  } catch (error) {
    console.log("============================================================")
    console.log("============================================================")
    console.error('❌ Database Connection Failed:', error)
    console.log("============================================================")
    console.log("============================================================")
    throw error
  }
}

/**
 * Migrate existing sessions table if needed
 */
export async function migrateSessionsTable() {
  try {
    console.log('🔄 Checking sessions table structure...')

    // Check if id column exists
    const check = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'sessions' AND column_name = 'id'
    `

    if (check.length === 0) {
      console.log('🔄 Migrating sessions table structure...')

      // Create temporary table with new structure
      await sql`
        CREATE TABLE IF NOT EXISTS sessions_new (
          id SERIAL PRIMARY KEY,
          phone_number TEXT UNIQUE NOT NULL,
          current_service TEXT,
          service_name TEXT,
          step TEXT,
          order_id TEXT,
          request_id INTEGER,
          menu_offset INTEGER DEFAULT 0,
          data JSONB DEFAULT '{}'::jsonb,
          started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `

      // Copy data from old table if exists
      try {
        await sql`
          INSERT INTO sessions_new (phone_number, current_service, service_name, step, order_id, data, started_at)
          SELECT phone_number, current_service, service_name, step, order_id, data, started_at
          FROM sessions
          ON CONFLICT (phone_number) DO NOTHING
        `
      } catch (e) {
        console.log('No data to migrate or migration not needed')
      }

      // Drop old table and rename new one
      await sql`DROP TABLE IF EXISTS sessions`
      await sql`ALTER TABLE sessions_new RENAME TO sessions`

      console.log('✅ Sessions table migrated successfully')
    } else {
      console.log('✅ Sessions table already has correct structure')
      
      // Secondary check for menu_offset column (if table existed but column didn't)
      const columnCheck = await sql`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'sessions' AND column_name = 'menu_offset'
      `
      if (columnCheck.length === 0) {
        console.log('🔄 Adding menu_offset column to sessions table...')
        await sql`ALTER TABLE sessions ADD COLUMN menu_offset INTEGER DEFAULT 0`
        console.log('✅ Column menu_offset added')
      }
    }

    return true
  } catch (error) {
    console.error('❌ Migration failed:', error)
    return false
  }
}

/**
 * Get database statistics
 */
export async function getDatabaseStats() {
  try {
    const tables = ['users', 'sessions', 'orders', 'requests_7_12', 'requests_8a', 'requests_property_card', 'requests_ferfar']
    const stats: Record<string, number> = {}

    for (const table of tables) {
      const result = await sql`
        SELECT COUNT(*) as count FROM ${sql(table)}
      `
      stats[table] = parseInt(result[0].count) || 0
    }

    return stats
  } catch (error) {
    console.error('Error getting database stats:', error)
    return {}
  }
}

export default sql