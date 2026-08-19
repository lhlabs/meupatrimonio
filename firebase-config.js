// Configuração pública do Firebase Web SDK.
// Não contém senha nem credencial administrativa; a autorização real é feita por Authentication + Firestore Rules.
export const firebaseConfig = {
  apiKey: "AIzaSyDrvDaJZuiyN-bM1L4qw8lN8q-gQtjXbig",
  authDomain: "meupatrimonio-4c878.firebaseapp.com",
  projectId: "meupatrimonio-4c878",
  storageBucket: "meupatrimonio-4c878.firebasestorage.app",
  messagingSenderId: "457912347612",
  appId: "1:457912347612:web:6413403bed3dd52809bd19"
};

// Chave pública do site para Firebase App Check + reCAPTCHA Enterprise.
export const appCheckSiteKey = "6Lfm8lwtAAAAAAbXI--eqSShT9hfmmj6ezeBQpnJ";

// Disponibiliza somente configuração pública para módulos independentes.
if (typeof window !== 'undefined') {
  globalThis.__MP_FIREBASE_CONFIG__ = firebaseConfig;

  // Cadastro e privacidade não alteram a persistência do Firebase Auth e podem
  // ser carregados imediatamente. A camada de sessão é carregada somente após
  // o evento load, quando app.js/mobile.js já concluíram sua inicialização.
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
