import { createClient } from '@supabase/supabase-js';
import { ENV } from '../configs/constant.js';

if (!ENV.SUPABASE_URL || !ENV.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(
    ENV.SUPABASE_URL || '',
    ENV.SUPABASE_SERVICE_ROLE_KEY || '',
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    }
);

export { supabase };
