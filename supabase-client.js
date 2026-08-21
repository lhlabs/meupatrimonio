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
    storage,
    experimental: {
      passkey: true
    }
  },
  global: {
    headers: {
      'X-Client-Info': 'meu-patrimonio-pwa/1.1'
    }
  }
});

let refreshPromise = null;

function sessionExpiresSoon(session, marginSeconds = 45) {
  const expiresAtMs = Number(session?.expires_at || 0) * 1000;
  return expiresAtMs > 0 && expiresAtMs - Date.now() <= marginSeconds * 1000;
}

export async function getSupabaseSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data?.session || null;
}

export async function refreshSupabaseSession() {
  if (!refreshPromise) {
    refreshPromise = supabase.auth.refreshSession()
      .then(({ data, error }) => {
        if (error) throw error;
        return data?.session || null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function ensureSupabaseSession() {
  const session = await getSupabaseSession();
  if (!session) return null;
  if (!sessionExpiresSoon(session)) return session;
  return refreshSupabaseSession();
}

export function isRecoverableAuthError(error) {
  const status = Number(error?.status ?? error?.statusCode ?? 0);
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || error || '').toLowerCase();
  return status === 401
    || code === 'pgrst301'
    || message.includes('jwt expired')
    || message.includes('invalid jwt')
    || message.includes('jwt is expired')
    || message.includes('token is expired')
    || message.includes('token has expired');
}
