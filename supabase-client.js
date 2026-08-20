import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3?bundle';
import { supabaseUrl, supabasePublishableKey, hasSupabaseConfig } from './supabase-config.js';

if (!hasSupabaseConfig()) {
  throw new Error('Configuração do Supabase ainda não foi preenchida.');
}

const isMobilePwa = typeof window !== 'undefined'
  && /\/mobile(?:\/|$)/.test(window.location.pathname);

// Preserva a política anterior do aplicativo:
// - web completa: sessão apenas na aba/sessão do navegador;
// - PWA mobile: login persistente no dispositivo, como no Firebase.
const storage = typeof window !== 'undefined'
  ? (isMobilePwa ? window.localStorage : window.sessionStorage)
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
