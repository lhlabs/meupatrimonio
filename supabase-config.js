// Configuração pública do Supabase Web SDK.
// A publishable key é pública por design; autorização real é feita por Auth + RLS.
export const supabaseUrl = '__SUPABASE_URL__';
export const supabasePublishableKey = '__SUPABASE_PUBLISHABLE_KEY__';

export function hasSupabaseConfig() {
  return /^https:\/\/.+\.supabase\.co$/.test(supabaseUrl)
    && supabasePublishableKey.startsWith('sb_publishable_');
}
