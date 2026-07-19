import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
/**
 * Cliente Supabase com service_role — usado APENAS no backend/worker.
 * Ignora RLS por design; a autorização é aplicada na lógica do pipeline.
 */
export const db = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
});
//# sourceMappingURL=db.js.map