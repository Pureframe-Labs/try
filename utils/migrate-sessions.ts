/**
 * Migration script for sessions table
 */

import { sql } from '../config/database.config'

async function migrateSessionsTable() {
    try {
        console.log('🔄 Migrating sessions table...')
        
        // Check if id column exists
        const check = await sql`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'sessions' AND column_name = 'id'
        `
        
        if (check.length === 0) {
            console.log('Adding id column to sessions table...')
            
            // Step 1: Add id column
            await sql`
                ALTER TABLE sessions 
                ADD COLUMN id SERIAL PRIMARY KEY
            `
            
            // Step 2: Remove old primary key
            await sql`
                ALTER TABLE sessions 
                DROP CONSTRAINT sessions_pkey
            `
            
            // Step 3: Add unique constraint
            await sql`
                ALTER TABLE sessions 
                ADD CONSTRAINT sessions_phone_unique UNIQUE (phone_number)
            `
            
            console.log('✅ Sessions table migrated successfully')
        } else {
            console.log('✅ Sessions table already has id column')
        }
        
    } catch (error) {
        console.error('❌ Migration failed:', error)
    }
}

// Run migration
migrateSessionsTable().then(() => {
    console.log('Migration completed')
    process.exit(0)
})