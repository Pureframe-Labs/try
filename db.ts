import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_DEFAULT_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn("⚠️ SUPABASE_URL or SUPABASE_ANON_KEY is missing from environment variables!");
}

export const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null as any;

// Note: With the Supabase REST API, table creation (CREATE TABLE) should be done 
// via the Supabase SQL Editor in the dashboard using the provided schema.sql, 
// rather than programmatically from the edge client.

export default supabase;