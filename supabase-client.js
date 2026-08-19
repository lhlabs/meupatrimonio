import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3?bundle';
import { supabaseUrl, supabasePublishableKey, hasSupabaseConfig } from './supabase-config.js';

if (!hasSupabaseConfig()) {
  throw new Error('Configuração do Supabase ainda não foi preenchida.');
}

const storage = typeof window !== 'undefined' && window.sessionStorage
  ? window.sessionStorage
  : undefined;

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage
  },
  global: {
    headers: {
      'X-Client-Info': 'meu-patrimonio-pwa/1.0'
    }
  }
});
