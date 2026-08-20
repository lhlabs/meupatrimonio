import { getApps, getApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const IDLE_STORAGE_KEY = 'mp:last-activity';
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
const IS_MOBILE_PWA = typeof window !== 'undefined'
  && /\/mobile(?:\/|$)/.test(window.location.pathname);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function resolveApp() {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (getApps().length) return getApp();
    await sleep(50);
  }
  throw new Error('Aplicativo indisponível para a camada de segurança.');
}

function now() {
  return Date.now();
}

function idleStorage() {
  try {
    // O PWA mobile mantém a sessão no dispositivo; por isso o relógio de
    // inatividade também precisa sobreviver ao fechamento/reabertura do app.
    return IS_MOBILE_PWA ? window.localStorage : window.sessionStorage;
  } catch (_) {
    return null;
  }
}

function getLastActivity() {
  try {
    const stored = Number(idleStorage()?.getItem(IDLE_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : now();
  } catch (_) {
    return now();
  }
}

function setLastActivity(value = now()) {
  try { idleStorage()?.setItem(IDLE_STORAGE_KEY, String(value)); }
  catch (_) {}
}

function clearLastActivity() {
  try { idleStorage()?.removeItem(IDLE_STORAGE_KEY); }
  catch (_) {}
}

function passwordIsStrong(password) {
  return typeof password === 'string'
    && password.length >= 12
    && password.length <= 128
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

function installRegistrationPasswordGuard() {
  document.addEventListener('submit', event => {
    if (event.target?.id !== 'registerForm') return;
    const password = event.target.querySelector('#registerPassword')?.value || '';
    if (passwordIsStrong(password)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const status = document.querySelector('#registerStatus');
    if (status) {
      status.textContent = 'Use uma senha com pelo menos 12 caracteres, incluindo maiúscula, minúscula, número e símbolo.';
      status.style.color = '#ff9aa2';
    }
  }, true);

  const applyPasswordUi = () => {
    const input = document.querySelector('#registerPassword');
    const confirm = document.querySelector('#registerPasswordConfirm');
    [input, confirm].forEach(field => {
      if (!field) return;
      field.minLength = 12;
      field.maxLength = 128;
    });
    const helper = document.querySelector('#registerPanel small.muted');
    if (helper) helper.textContent = 'Use 12 ou mais caracteres, com maiúscula, minúscula, número e símbolo. Não reutilize senhas.';
    return !!input && !!confirm && !!helper;
  };

  if (applyPasswordUi()) return;
  const observer = new MutationObserver(() => {
    if (applyPasswordUi()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function installAuthMessageGuard() {
  const attach = () => {
    const status = document.querySelector('#registerStatus');
    if (!status || status.dataset.securityMessageGuard === '1') return false;

    const sanitize = () => {
      const message = status.textContent || '';
      if (/já existe uma conta com este e-mail/i.test(message)) {
        status.textContent = 'Não foi possível criar a conta com estes dados. Se você já possui cadastro, tente entrar ou redefinir a senha.';
        return;
      }
      if (/pelo menos 8 caracteres|mínimo 8 caracteres|no mínimo 8 caracteres/i.test(message)) {
        status.textContent = 'Use uma senha com pelo menos 12 caracteres, incluindo maiúscula, minúscula, número e símbolo.';
      }
    };

    status.dataset.securityMessageGuard = '1';
    new MutationObserver(sanitize).observe(status, { childList: true, characterData: true, subtree: true });
    sanitize();
    return true;
  };

  if (attach()) return;
  const observer = new MutationObserver(() => {
    if (attach()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

try {
  installRegistrationPasswordGuard();
  installAuthMessageGuard();

  const app = await resolveApp();
  const auth = getAuth(app);

  let idleTimer = null;
  let currentUser = null;
  let lastActivity = getLastActivity();

  const clearIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };

  const lockForInactivity = async () => {
    if (!currentUser) return;
    try {
      await signOut(auth);
      clearLastActivity();
    } finally {
      window.location.reload();
    }
  };

  const scheduleIdleCheck = () => {
    clearIdleTimer();
    if (!currentUser) return;
    const remaining = Math.max(0, IDLE_TIMEOUT_MS - (now() - lastActivity));
    idleTimer = setTimeout(async () => {
      if (!currentUser) return;
      if (now() - lastActivity >= IDLE_TIMEOUT_MS) await lockForInactivity();
      else scheduleIdleCheck();
    }, remaining + 100);
  };

  const markActivity = () => {
    if (!currentUser) return;
    const current = now();
    if (current - lastActivity < 1000) return;
    lastActivity = current;
    setLastActivity(current);
    scheduleIdleCheck();
  };

  ACTIVITY_EVENTS.forEach(name => window.addEventListener(name, markActivity, { passive: true }));
  document.addEventListener('visibilitychange', async () => {
    if (!currentUser || document.visibilityState !== 'visible') return;
    if (now() - lastActivity >= IDLE_TIMEOUT_MS) {
      await lockForInactivity();
      return;
    }
    markActivity();
  });

  onAuthStateChanged(auth, async nextUser => {
    currentUser = nextUser;
    clearIdleTimer();
    if (!nextUser) {
      clearLastActivity();
      return;
    }
    lastActivity = getLastActivity();
    if (now() - lastActivity >= IDLE_TIMEOUT_MS) {
      await lockForInactivity();
      return;
    }
    setLastActivity(lastActivity);
    scheduleIdleCheck();
  });
} catch (error) {
  console.warn('Camada adicional de segurança indisponível.', error);
}
