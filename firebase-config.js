import "./enhancements.js";
import "./finance-v3.js";

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
