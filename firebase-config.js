// Arquivo mantido com o mesmo nome apenas para preservar imports existentes.
// O aplicativo não carrega mais o Firebase SDK; os imports Firebase são
// redirecionados por import map para a camada de compatibilidade Supabase.
export const firebaseConfig = { provider: 'supabase' };
export const appCheckSiteKey = '';

const AUTH_BUILD = '20260820c';

if (typeof window !== 'undefined') {
  globalThis.__MP_FIREBASE_CONFIG__ = firebaseConfig;

  Promise.allSettled([
    import(`./registration.js?v=${AUTH_BUILD}`),
    import(`./privacy-controls.js?v=${AUTH_BUILD}`)
  ]).then(results => {
    results.forEach(result => {
      if (result.status === 'rejected') console.error('Módulo complementar indisponível.', result.reason);
    });
  });

  const loadSessionHardening = () => {
    import(`./security-hardening.js?v=${AUTH_BUILD}`).catch(error => {
      console.error('Camada de segurança de sessão indisponível.', error);
    });
  };

  if (document.readyState === 'complete') loadSessionHardening();
  else window.addEventListener('load', loadSessionHardening, { once: true });
}
