import { supabase, ensureSupabaseSession } from '../supabase-client.js';

export const browserLocalPersistence = 'local';
export const browserSessionPersistence = 'session';

let rawUser = null;
let lastSignup = { email: '', at: 0 };
let recoveryHandled = false;
let authRevision = 0;
let passkeyEnrollmentRequested = false;
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
  const rawCode = String(error.code || '').toLowerCase();
  const name = String(error.name || '').toLowerCase();
  let code = 'auth/internal-error';
  if (message.includes('invalid login credentials')) code = 'auth/invalid-credential';
  else if (message.includes('email not confirmed')) code = 'auth/email-not-verified';
  else if (message.includes('user already registered') || message.includes('already been registered')) code = 'auth/email-already-in-use';
  else if (message.includes('password') && (message.includes('weak') || message.includes('least'))) code = 'auth/weak-password';
  else if (message.includes('rate limit') || message.includes('too many')) code = 'auth/too-many-requests';
  else if (message.includes('invalid email') || (message.includes('email address') && message.includes('invalid'))) code = 'auth/invalid-email';
  else if (message.includes('network') || message.includes('fetch') || message.includes('load failed')) code = 'auth/network-request-failed';
  else if (rawCode === 'passkey_disabled') code = 'auth/passkey-disabled';
  else if (rawCode === 'webauthn_credential_not_found') code = 'auth/passkey-not-found';
  else if (rawCode.startsWith('webauthn_')) code = 'auth/passkey-failed';
  else if (name === 'notallowederror') code = 'auth/passkey-cancelled';
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

function showAuthMessage(message) {
  if (typeof document === 'undefined') return;
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 3200);
}

function supportsPasskeys() {
  return typeof window !== 'undefined'
    && typeof window.PublicKeyCredential !== 'undefined'
    && typeof supabase.auth.signInWithPasskey === 'function'
    && typeof supabase.auth.registerPasskey === 'function';
}

function passkeyName(action = 'Entrar') {
  const appleMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  return appleMobile ? `${action} com Face ID` : `${action} com biometria`;
}

async function registerRequestedPasskey() {
  if (!passkeyEnrollmentRequested || !supportsPasskeys()) return;
  passkeyEnrollmentRequested = false;
  try {
    const { error } = await supabase.auth.registerPasskey();
    if (error) throw normalizeError(error);
    showAuthMessage('Face ID ativado. No próximo acesso, use a biometria.');
  } catch (error) {
    const normalized = error?.code ? error : normalizeError(error);
    if (normalized.code === 'auth/passkey-disabled') {
      showAuthMessage('Face ID precisa ser habilitado no Supabase antes do primeiro cadastro.');
    } else if (normalized.code !== 'auth/passkey-cancelled') {
      console.error('Falha ao cadastrar passkey.', normalized);
      showAuthMessage('Não foi possível ativar o Face ID agora. O login por senha continua funcionando.');
    }
  }
}

async function signInWithPasskey() {
  const { data, error } = await supabase.auth.signInWithPasskey();
  if (error) throw normalizeError(error);
  const signedInUser = data?.user || data?.session?.user || null;
  updateRawUser(signedInUser);
  await ensureSupabaseSession();
  notifyLocalAuth(signedInUser);
  return { user: mapUser(signedInUser) };
}

function installPasskeyLoginButton() {
  if (!supportsPasskeys() || typeof document === 'undefined') return;
  const form = document.getElementById('loginForm');
  if (!form || document.getElementById('passkeyLoginBtn')) return;

  const button = document.createElement('button');
  button.id = 'passkeyLoginBtn';
  button.type = 'button';
  button.className = document.getElementById('resetPasswordBtn')?.className || 'link-button';
  button.textContent = passkeyName('Entrar');
  button.setAttribute('aria-label', passkeyName('Entrar'));

  const resetButton = document.getElementById('resetPasswordBtn');
  if (resetButton?.parentNode) resetButton.parentNode.insertBefore(button, resetButton);
  else form.insertAdjacentElement('afterend', button);

  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await signInWithPasskey();
    } catch (error) {
      if (error.code === 'auth/passkey-disabled') {
        showAuthMessage('Face ID ainda não está habilitado no servidor.');
      } else if (error.code === 'auth/passkey-cancelled') {
        // O usuário simplesmente fechou o seletor biométrico.
      } else {
        // Sem passkey neste dispositivo: o próximo login por senha cadastra uma.
        passkeyEnrollmentRequested = true;
        showAuthMessage('Entre com e-mail e senha uma vez para ativar o Face ID.');
        document.getElementById('email')?.focus();
      }
    } finally {
      button.disabled = false;
    }
  });
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
  installPasskeyLoginButton();
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

  // Antes de liberar a UI, garante que a sessão que acabou de ser emitida já é
  // a sessão corrente usada pelo cliente de dados. Isso fecha a janela em que
  // uma das consultas paralelas podia sair com o token anterior e receber 401.
  await ensureSupabaseSession();

  // Quando o usuário tentou Face ID sem uma passkey cadastrada, o login por
  // senha desta vez serve para cadastrar a credencial biométrica com segurança.
  await registerRequestedPasskey();

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

  // Assina os eventos antes de ler o snapshot inicial. Assim nenhum login,
  // logout ou restauração de sessão que aconteça durante o bootstrap é perdido.
  const { data: subscriptionData } = supabase.auth.onAuthStateChange((event, session) => {
    const eventUser = session?.user || null;
    updateRawUser(eventUser);

    // O callback do Supabase permanece estritamente síncrono. Todo trabalho da
    // aplicação é deslocado para um macrotask, evitando o deadlock documentado.
    notifyLocalAuth(eventUser);
    if (event === 'PASSWORD_RECOVERY') {
      setTimeout(() => void handlePasswordRecovery(), 0);
    }
  });

  supabase.auth.getSession().then(({ data, error }) => {
    // Se a autenticação mudou enquanto o snapshot inicial estava em voo, ele
    // não pode sobrescrever o estado mais novo recebido pelo listener.
    if (!active || authRevision !== initialRevision) return;
    if (error || delivered) return;
    updateRawUser(data?.session?.user || null);
    deliver(rawUser);
  }).catch(() => {
    if (!active || authRevision !== initialRevision) return;
    if (delivered) return;
    updateRawUser(null);
    deliver(null);
  });

  return () => {
    active = false;
    localAuthListeners.delete(deliver);
    subscriptionData?.subscription?.unsubscribe?.();
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
  await ensureSupabaseSession();
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

installPasskeyLoginButton();
