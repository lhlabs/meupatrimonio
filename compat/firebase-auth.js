import { supabase } from '../supabase-client.js';

export const browserLocalPersistence = 'local';
export const browserSessionPersistence = 'session';

let rawUser = null;
let lastSignup = { email: '', at: 0 };
let recoveryHandled = false;
let authRevision = 0;
const localAuthListeners = new Set();

function appUrl() {
  if (typeof window === 'undefined') return undefined;
  const url = new URL(window.location.href);
  url.hash = '';
  url.search = '';
  return url.toString();
}

function mapUser(user) {
  if (!user) return null;
  return {
    uid: user.id,
    email: user.email || '',
    emailVerified: !!user.email_confirmed_at,
    _supabaseUser: user
  };
}

function normalizeError(error) {
  if (!error) return null;
  const message = String(error.message || error).toLowerCase();
  let code = 'auth/internal-error';
  if (message.includes('invalid login credentials')) code = 'auth/invalid-credential';
  else if (message.includes('email not confirmed')) code = 'auth/email-not-verified';
  else if (message.includes('user already registered') || message.includes('already been registered')) code = 'auth/email-already-in-use';
  else if (message.includes('password') && (message.includes('weak') || message.includes('least'))) code = 'auth/weak-password';
  else if (message.includes('rate limit') || message.includes('too many')) code = 'auth/too-many-requests';
  else if (message.includes('invalid email') || (message.includes('email address') && message.includes('invalid'))) code = 'auth/invalid-email';
  else if (message.includes('network') || message.includes('fetch')) code = 'auth/network-request-failed';
  const wrapped = new Error(error.message || 'Falha de autenticação.');
  wrapped.code = code;
  wrapped.cause = error;
  return wrapped;
}

function updateRawUser(user) {
  rawUser = user || null;
  authRevision += 1;
  return rawUser;
}

function notifyLocalAuth(user) {
  const snapshot = user || null;
  setTimeout(() => {
    for (const listener of [...localAuthListeners]) listener(snapshot);
  }, 0);
}

const authFacade = {
  get currentUser() { return mapUser(rawUser); },
  languageCode: 'pt-BR'
};

async function refreshCurrentUser() {
  const observedRevision = authRevision;
  const { data, error } = await supabase.auth.getUser();
  if (error && !String(error.message || '').toLowerCase().includes('session')) throw normalizeError(error);
  // Uma resposta iniciada antes de um login/logout não pode sobrescrever
  // o estado mais novo já conhecido pelo cliente.
  if (authRevision !== observedRevision) return mapUser(rawUser);
  updateRawUser(data?.user || null);
  return mapUser(rawUser);
}

export function getAuth() {
  return authFacade;
}

export async function setPersistence() {
  // O cliente Supabase define o storage em supabase-client.js. Mantido como
  // no-op para preservar o contrato legado da interface Firebase.
}

export async function signInWithEmailAndPassword(_auth, email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw normalizeError(error);
  const signedInUser = data.user || data.session?.user || null;
  updateRawUser(signedInUser);

  // Entrega o usuário diretamente após o login ter terminado. Assim a UI não
  // depende de um segundo evento do Supabase para sair da tela de acesso.
  notifyLocalAuth(signedInUser);
  return { user: mapUser(signedInUser) };
}

export async function createUserWithEmailAndPassword(_auth, email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: appUrl() }
  });
  if (error) throw normalizeError(error);
  updateRawUser(data.user || null);
  lastSignup = { email: String(email).toLowerCase(), at: Date.now() };
  return { user: mapUser(rawUser) };
}

export async function sendEmailVerification(targetUser) {
  const email = targetUser?.email || '';
  if (!email) throw normalizeError(new Error('E-mail indisponível.'));

  // signUp já solicita a primeira confirmação. Evita envio duplicado imediato.
  if (lastSignup.email === email.toLowerCase() && Date.now() - lastSignup.at < 10000) return;

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: appUrl() }
  });
  if (error) throw normalizeError(error);
}

export async function sendPasswordResetEmail(_auth, email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: appUrl()
  });
  if (error) throw normalizeError(error);
}

export async function signOut() {
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  updateRawUser(null);
  notifyLocalAuth(null);
  if (error && !String(error.message || '').toLowerCase().includes('session')) throw normalizeError(error);
}

export function onAuthStateChanged(_auth, callback) {
  let active = true;
  let delivered = false;
  let deliveredUid = undefined;
  const initialRevision = authRevision;

  const deliver = user => {
    if (!active) return;
    const mapped = mapUser(user);
    const uid = mapped?.uid ?? null;
    if (delivered && uid === deliveredUid) return;
    delivered = true;
    deliveredUid = uid;
    callback(mapped);
  };

  // Login/logout concluídos pelo próprio adaptador notificam este listener
  // diretamente, sem depender do timing interno do onAuthStateChange.
  localAuthListeners.add(deliver);

  supabase.auth.getSession().then(({ data }) => {
    // O snapshot inicial é descartado se qualquer alteração de autenticação
    // aconteceu enquanto a leitura estava em andamento.
    if (!active || authRevision !== initialRevision) return;
    updateRawUser(data?.session?.user || null);
    deliver(rawUser);
  }).catch(() => {
    if (!active || authRevision !== initialRevision) return;
    updateRawUser(null);
    deliver(null);
  });

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    const eventUser = session?.user || null;
    updateRawUser(eventUser);

    // O callback do Supabase permanece estritamente síncrono. Todo trabalho da
    // aplicação é deslocado para um macrotask, evitando o deadlock documentado.
    notifyLocalAuth(eventUser);
    if (event === 'PASSWORD_RECOVERY') {
      setTimeout(() => void handlePasswordRecovery(), 0);
    }
  });

  return () => {
    active = false;
    localAuthListeners.delete(deliver);
    data?.subscription?.unsubscribe?.();
  };
}

export const EmailAuthProvider = {
  credential(email, password) {
    return { email, password };
  }
};

export async function reauthenticateWithCredential(_currentUser, credential) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: credential.email,
    password: credential.password
  });
  if (error) throw normalizeError(error);
  updateRawUser(data.user || null);
  return { user: mapUser(rawUser) };
}

export async function deleteUser() {
  const { data, error } = await supabase.functions.invoke('delete-account', {
    body: { confirm: true }
  });
  if (error) throw normalizeError(error);
  if (!data?.deleted) throw new Error('A exclusão da conta não foi confirmada pelo servidor.');
  updateRawUser(null);
  notifyLocalAuth(null);
}

async function handlePasswordRecovery() {
  if (recoveryHandled || typeof window === 'undefined') return;
  recoveryHandled = true;

  const password = window.prompt('Informe sua nova senha (mínimo de 12 caracteres, com maiúscula, minúscula, número e símbolo):');
  if (!password) return;
  const strong = password.length >= 12
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
  if (!strong) {
    window.alert('A nova senha não atende aos requisitos de segurança. Solicite a redefinição novamente.');
    return;
  }

  const confirmation = window.prompt('Confirme a nova senha:');
  if (confirmation !== password) {
    window.alert('As senhas não coincidem. Solicite a redefinição novamente.');
    return;
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    window.alert('Não foi possível alterar a senha. Solicite um novo link de redefinição.');
    return;
  }

  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  updateRawUser(null);
  window.alert('Senha alterada com sucesso. Entre novamente com a nova senha.');
  const clean = new URL(window.location.href);
  clean.hash = '';
  clean.search = '';
  window.location.replace(clean.toString());
}

refreshCurrentUser().catch(() => {});
