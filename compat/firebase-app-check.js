export class ReCaptchaEnterpriseProvider {
  constructor(siteKey) {
    this.siteKey = siteKey;
  }
}

export function initializeAppCheck() {
  // Supabase não usa Firebase App Check. A proteção de dados passa a ser
  // Supabase Auth + RLS no PostgreSQL.
  return null;
}
