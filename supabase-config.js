// Configuração pública do Supabase Web SDK.
// A publishable key é pública por design; autorização real é feita por Auth + RLS.
export const supabaseUrl = 'https://judwmajgcrvhaqlkqcci.supabase.co';
export const supabasePublishableKey = 'sb_publishable_91hCYqYJpqsmQRBwBrcfXg_C86NF1LP';

export function hasSupabaseConfig() {
  return /^https:\/\/.+\.supabase\.co$/.test(supabaseUrl)
    && supabasePublishableKey.startsWith('sb_publishable_');
}
