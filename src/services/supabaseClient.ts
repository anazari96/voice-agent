import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase URL or Key is missing from environment variables.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

export interface BusinessInfo {
  id?: string;
  business_name: string;
  description: string;
  hours: string;
  contact_info: string;
  created_at?: string;
}

