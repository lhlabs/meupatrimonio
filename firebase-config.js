// Arquivo mantido com o mesmo nome apenas para preservar imports existentes.
// O aplicativo não carrega mais o Firebase SDK; os imports Firebase são
// redirecionados por import map para a camada de compatibilidade Supabase.
export const firebaseConfig = { provider: 'supabase' };
export const appCheckSiteKey = '';

if (typeof window !== 'undefined') {
  globalThis.__MP_FIREBASE_CONFIG__ = firebaseConfig;

  Promise.allSettled([
    import('./registration.js'),
    import('./privacy-controls.js')
  ]).then(results => {
    results.forEach(result => {
      if (result.status === 'rejected') console.error('Módulo complementar indisponível.', result.reason);
    });
  });

  const loadSessionHardening = () => {
    import('./security-hardening.js').catch(error => {
      console.error('Camada de segurança de sessão indisponível.', error);
    });
  };

  if (document.readyState === 'complete') loadSessionHardening();
  else window.addEventListener('load', loadSessionHardening, { once: true });
}
