import { getApps, getApp, initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function resolveApp() {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (getApps().length) return getApp();
    await sleep(50);
  }
  const config = globalThis.__MP_FIREBASE_CONFIG__;
  if (!config) throw new Error('Configuração do Firebase indisponível.');
  return initializeApp(config);
}

function authMessage(error) {
  const code = String(error?.code || '');
  if (code.includes('email-already-in-use')) return 'Já existe uma conta com este e-mail.';
  if (code.includes('invalid-email')) return 'Informe um e-mail válido.';
  if (code.includes('weak-password')) return 'Use uma senha mais forte, com pelo menos 8 caracteres.';
  if (code.includes('too-many-requests')) return 'Muitas tentativas. Aguarde um pouco e tente novamente.';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'E-mail ou senha inválidos.';
  if (code.includes('network-request-failed')) return 'Falha de conexão. Verifique sua internet e tente novamente.';
  return 'Não foi possível concluir a autenticação. Tente novamente.';
}

function injectRegistrationUi() {
  const authCard = document.querySelector('#authView .auth-card');
  const loginForm = document.querySelector('#loginForm');
  const resetButton = document.querySelector('#resetPasswordBtn');
  if (!authCard || !loginForm || document.querySelector('#registerPanel')) return null;

  const openButton = document.createElement('button');
  openButton.id = 'openRegisterBtn';
  openButton.type = 'button';
  openButton.className = 'link-button';
  openButton.textContent = 'Criar minha conta';
  resetButton?.insertAdjacentElement('afterend', openButton);

  const panel = document.createElement('div');
  panel.id = 'registerPanel';
  panel.hidden = true;
  panel.innerHTML = `
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08)">
      <div class="eyebrow">NOVA CONTA</div>
      <h2 style="margin:4px 0 6px;font-size:1.2rem">Crie seu acesso</h2>
      <p class="muted" style="margin:0 0 12px">Seus dados ficam separados dos demais usuários pelo seu identificador de autenticação.</p>
      <form id="registerForm" autocomplete="on">
        <label>E-mail<input id="registerEmail" type="email" autocomplete="email" maxlength="254" required /></label>
        <label>Senha<input id="registerPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required /></label>
        <label>Confirmar senha<input id="registerPasswordConfirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required /></label>
        <small class="muted" style="display:block;margin:-4px 0 12px">Use no mínimo 8 caracteres e evite reutilizar senhas de outros serviços.</small>
        <button type="submit" class="primary">Criar conta</button>
      </form>
      <div id="registerStatus" class="muted" role="status" aria-live="polite" style="margin-top:10px"></div>
      <button id="backToLoginBtn" class="link-button" type="button">Voltar para entrar</button>
    </div>`;
  authCard.appendChild(panel);

  const status = panel.querySelector('#registerStatus');
  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.style.color = isError ? '#ff9aa2' : '';
  };
  const showRegister = () => {
    loginForm.hidden = true;
    if (resetButton) resetButton.hidden = true;
    openButton.hidden = true;
    panel.hidden = false;
    setStatus('');
    panel.querySelector('#registerEmail')?.focus();
  };
  const showLogin = () => {
    panel.hidden = true;
    loginForm.hidden = false;
    if (resetButton) resetButton.hidden = false;
    openButton.hidden = false;
    setStatus('');
    document.querySelector('#email')?.focus();
  };

  openButton.addEventListener('click', showRegister);
  panel.querySelector('#backToLoginBtn').addEventListener('click', showLogin);
  return { panel, setStatus, showLogin, showRegister };
}

try {
  const app = await resolveApp();
  const auth = getAuth(app);
  const db = getFirestore(app);
  const ui = injectRegistrationUi();

  if (ui) {
    const loginForm = document.querySelector('#loginForm');
    loginForm?.addEventListener('submit', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const button = event.submitter;
      const email = document.querySelector('#email')?.value.trim() || '';
      const password = document.querySelector('#password')?.value || '';
      if (button) button.disabled = true;
      try {
        const credential = await signInWithEmailAndPassword(auth, email, password);
        if (!credential.user.emailVerified) {
          const root = await getDoc(doc(db, 'users', credential.user.uid));
          if (!root.exists()) {
            try { await sendEmailVerification(credential.user); } catch (_) {}
            await signOut(auth);
            ui.showRegister();
            const registerEmail = document.querySelector('#registerEmail');
            if (registerEmail) registerEmail.value = email;
            ui.setStatus('Confirme seu e-mail antes do primeiro acesso. Se necessário, enviamos um novo link de verificação.', true);
            return;
          }
        }
      } catch (error) {
        console.error('Falha de autenticação.', error);
        const toast = document.querySelector('#toast');
        if (toast) {
          toast.textContent = authMessage(error);
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 2800);
        }
      } finally {
        if (button) button.disabled = false;
      }
    }, true);

    ui.panel.querySelector('#registerForm').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = event.submitter;
      const email = form.querySelector('#registerEmail').value.trim();
      const password = form.querySelector('#registerPassword').value;
      const confirmation = form.querySelector('#registerPasswordConfirm').value;

      ui.setStatus('');
      if (password.length < 8) return ui.setStatus('A senha precisa ter pelo menos 8 caracteres.', true);
      if (password !== confirmation) return ui.setStatus('As senhas não coincidem.', true);
      if (button) button.disabled = true;

      try {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(credential.user);
        await signOut(auth);
        form.reset();
        ui.setStatus('Conta criada. Enviamos um link para confirmar seu e-mail. Depois da confirmação, entre normalmente.');
      } catch (error) {
        console.error('Falha ao criar conta.', error);
        ui.setStatus(authMessage(error), true);
      } finally {
        if (button) button.disabled = false;
      }
    });
  }
} catch (error) {
  console.error('Módulo de cadastro indisponível.', error);
}
