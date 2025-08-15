// Import the Supabase client library
import { createClient } from '@supabase/supabase-js'

// Grab the Supabase URL and anon key from environment variables
// Make sure your .env file has VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Initialize the Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
