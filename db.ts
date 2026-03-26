import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import 'dotenv/config';

/** ============================================================================
 * SUPABASE CLIENT (Optional - for REST API operations)
 * ============================================================================ */
const supabaseUrl = process.env.SUPABASE_URL || 'https://bxircahzopvrqrmkqevu.supabase.co' 
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_HKpm50yPWZsB5K2NWCugtA_zmxdnz57';

if (!supabaseUrl || !supabaseKey) {
  console.warn("⚠️ SUPABASE_URL or SUPABASE_KEY is missing from environment variables!");
}

export const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null as any;

/** ============================================================================
 * POSTGRESQL DATABASE SETUP (Primary Database)
 * ============================================================================ */

// Load environment variables for database connection
const DB_HOST = 'aws-1-ap-southeast-1.pooler.supabase.com'
const DB_PORT = 6543
const DB_NAME = 'postgres'
const DB_USER = 'postgres.bxircahzopvrqrmkqevu'
const DB_PASSWORD = '3fV4OwvK6uCrH62M'
const DATABASE_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`

// Database connection validation
const connectionString = 'postgresql://postgres:3fV4OwvK6uCrH62M@db.bxircahzopvrqrmkqevu.supabase.co:5432/postgres'

if (!DATABASE_URL && (!DB_HOST || !DB_PORT || !DB_NAME || !DB_USER || !DB_PASSWORD)) {
  console.warn('⚠️ Database configuration is incomplete.')
  console.warn('   Please provide DATABASE_URL or all DB_* variables in your .env file.')
}

/**
 * PostgreSQL Client Instance
 */
export const sql = postgres(
  connectionString,
  {
    onnotice: () => { }, // Suppress notice logs
    connect_timeout: 30, // 30s connection timeout
    max: 10 // Connection pool size to handle concurrent requests
  }
)

/** ============================================================================
 * DATABASE SCHEMA INITIALIZATION
 * ============================================================================ */

/**
 * Initializes all database tables and indices
 * Creates the following tables:
 * - requests_7_12: 7/12 land records
 * - requests_8a: 8A land records
 * - requests_property_card: Property card records
 * - requests_ferfar: Ferfar records
 * - users: User information
 * - sessions: WhatsApp conversation sessions
 * - orders: Payment orders/transactions
 */
export async function initializeDatabase() {
  try {
    console.log("============================================================")
    console.log("============================================================")
    console.log('⏳ Initializing Database Tables...')
    console.log("============================================================")
    console.log("============================================================")

    // TABLE 1: Requests 7/12 (SatBara)
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
    console.log("✅ Table 'requests_7_12' created/verified")

    // TABLE 2: Requests 8A
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
    console.log("✅ Table 'requests_8a' created/verified")

    // TABLE 3: Requests Property Card
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
    console.log("✅ Table 'requests_property_card' created/verified")

    // TABLE 4: Requests Ferfar
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
    console.log("✅ Table 'requests_ferfar' created/verified")

    // TABLE 5: Users
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
    console.log("✅ Table 'users' created/verified")

    // TABLE 6: Sessions
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
    console.log("✅ Table 'sessions' created/verified")

    // TABLE 7: Orders
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
    console.log("✅ Table 'orders' created/verified")

    // CREATE INDICES for better query performance
    console.log("\n⏳ Creating indices...")
    
    await sql`CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phone_number)`
    await sql`CREATE INDEX IF NOT EXISTS idx_orders_razorpay_id ON orders(razorpay_order_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(whatsapp_phone)`
    await sql`CREATE INDEX IF NOT EXISTS idx_users_phone ON users(whatsapp_phone)`
    await sql`CREATE INDEX IF NOT EXISTS idx_requests_7_12_phone ON requests_7_12(whatsapp_phone)`
    await sql`CREATE INDEX IF NOT EXISTS idx_requests_7_12_status ON requests_7_12(status)`
    await sql`CREATE INDEX IF NOT EXISTS idx_requests_8a_phone ON requests_8a(whatsapp_phone)`
    await sql`CREATE INDEX IF NOT EXISTS idx_requests_8a_status ON requests_8a(status)`
    await sql`CREATE INDEX IF NOT EXISTS idx_requests_pc_phone ON requests_property_card(whatsapp_phone)`
    await sql`CREATE INDEX IF NOT EXISTS idx_requests_pc_status ON requests_property_card(status)`
    await sql`CREATE INDEX IF NOT EXISTS idx_requests_ferfar_phone ON requests_ferfar(whatsapp_phone)`
    await sql`CREATE INDEX IF NOT EXISTS idx_requests_ferfar_status ON requests_ferfar(status)`
    
    console.log("✅ All indices created/verified")

    console.log("\n============================================================")
    console.log("============================================================")
    console.log('✅ Database Initialization Completed Successfully!')
    console.log("============================================================")
    console.log("============================================================")
    return true
  } catch (error) {
    console.error("\n============================================================")
    console.error("============================================================")
    console.error('❌ Database Initialization Error:', error)
    console.error("============================================================")
    console.error("============================================================")
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
    console.log("✅ Database Connection Successful")
    console.log("   Server Time:", result[0].time)
    console.log("============================================================")
    return true
  } catch (error) {
    console.error("============================================================")
    console.error('❌ Database Connection Failed:', error)
    console.error("============================================================")
    throw error
  }
}

/**
 * Get database statistics
 */
export async function getDatabaseStats() {
  try {
    const tables = await sql`
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    `
    return tables
  } catch (error) {
    console.error('Error fetching database stats:', error)
    throw error
  }
}

export default supabase;