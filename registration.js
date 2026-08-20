import { getApps, getApp, initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function resolveApp() {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (getApps().length) return getApp();
    await sleep(50);
  }
  const config = globalThis.__MP_FIREBASE_CONFIG__;
  if (!config) throw new Error('Configuração de autenticação indisponível.');
  return initializeApp(config);
}

function authMessage(error) {
  const code = String(error?.code || '');
  if (code.includes('email-already-in-use')) return 'Não foi possível criar a conta com estes dados. Se você já possui cadastro, tente entrar ou redefinir a senha.';
  if (code.includes('invalid-email')) return 'Informe um e-mail válido.';
  if (code.includes('weak-password')) return 'Use uma senha mais forte.';
  if (code.includes('too-many-requests')) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  if (code.includes('email-not-verified')) return 'Confirme seu e-mail antes de entrar. Verifique também Spam, Lixo eletrônico e Promoções.';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'E-mail ou senha inválidos.';
  if (code.includes('network-request-failed')) return 'Falha de conexão. Verifique sua internet e tente novamente.';
  return `Não foi possível concluir a autenticação${code ? ` (${code})` : ''}.`;
}

function verificationMessage(error) {
  const code = String(error?.code || '');
  if (code.includes('too-many-requests')) return 'O serviço bloqueou novos envios temporariamente por excesso de tentativas. Aguarde alguns minutos e tente novamente.';
  if (code.includes('network-request-failed')) return 'Não foi possível solicitar o e-mail de confirmação por falha de conexão.';
  return 'Não foi possível solicitar o e-mail de confirmação agora. Tente novamente em alguns minutos.';
}

function setVisible(element, visible) {
  if (!element) return;
  element.hidden = !visible;
  element.style.display = visible ? '' : 'none';
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
  panel.style.display = 'none';
  panel.innerHTML = `
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08)">
      <div class="eyebrow">NOVA CONTA</div>
      <h2 style="margin:4px 0 6px;font-size:1.2rem">Crie seu acesso</h2>
      <p class="muted" style="margin:0 0 12px">Cada conta possui um identificador exclusivo. Seus dados financeiros ficam separados dos demais usuários por autenticação e regras RLS.</p>
      <form id="registerForm" autocomplete="on">
        <label>E-mail<input id="registerEmail" type="email" autocomplete="email" maxlength="254" required /></label>
        <label>Senha<input id="registerPassword" type="password" autocomplete="new-password" minlength="12" maxlength="128" required /></label>
        <label>Confirmar senha<input id="registerPasswordConfirm" type="password" autocomplete="new-password" minlength="12" maxlength="128" required /></label>
        <small class="muted" style="display:block;margin:-4px 0 12px">Use 12 ou mais caracteres, com maiúscula, minúscula, número e símbolo. Não reutilize senhas.</small>
        <button type="submit" class="primary">Criar conta</button>
      </form>
      <div id="registerStatus" class="muted" role="status" aria-live="polite" style="margin-top:12px"></div>
      <button id="resendVerificationBtn" class="ghost-btn" type="button" style="display:none;margin-top:10px">Reenviar e-mail de confirmação</button>
      <button id="backToLoginBtn" class="link-button" type="button">Voltar para entrar</button>
    </div>`;
  authCard.appendChild(panel);

  const status = panel.querySelector('#registerStatus');
  const resendButton = panel.querySelector('#resendVerificationBtn');
  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.style.color = isError ? '#ff9aa2' : '';
  };
  const showResend = show => setVisible(resendButton, show);
  const showRegister = () => {
    setVisible(loginForm, false);
    setVisible(resetButton, false);
    setVisible(openButton, false);
    setVisible(panel, true);
    setStatus('');
    showResend(false);
    panel.querySelector('#registerEmail')?.focus();
  };
  const showLogin = () => {
    setVisible(panel, false);
    setVisible(loginForm, true);
    setVisible(resetButton, true);
    setVisible(openButton, true);
    setStatus('');
    showResend(false);
    document.querySelector('#email')?.focus();
  };

  openButton.addEventListener('click', showRegister);
  panel.querySelector('#backToLoginBtn').addEventListener('click', showLogin);
  return { panel, resendButton, setStatus, showResend, showLogin, showRegister };
}

async function requestVerification(email) {
  await sendEmailVerification({ email });
}

try {
  const app = await resolveApp();
  const auth = getAuth(app);
  const ui = injectRegistrationUi();

  if (ui) {
    // O formulário de login pertence exclusivamente ao app.js/mobile.js.
    // Este módulo cuida apenas de cadastro e verificação de e-mail para evitar
    // handlers concorrentes disparando múltiplos logins no mesmo clique.
    ui.panel.querySelector('#registerForm').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = event.submitter;
      const email = form.querySelector('#registerEmail').value.trim();
      const password = form.querySelector('#registerPassword').value;
      const confirmation = form.querySelector('#registerPasswordConfirm').value;

      ui.setStatus('');
      ui.showResend(false);
      if (password !== confirmation) return ui.setStatus('As senhas não coincidem.', true);
      if (button) button.disabled = true;

      try {
        await createUserWithEmailAndPassword(auth, email, password);
        ui.setStatus('Conta criada. Enviamos um e-mail de confirmação. Abra o link recebido e depois entre normalmente. Verifique também Spam, Lixo eletrônico e Promoções.');
        ui.showResend(true);
      } catch (error) {
        console.error('Falha ao criar conta.', error);
        ui.setStatus(authMessage(error), true);
        if (String(error?.code || '').includes('email-already-in-use')) ui.showResend(true);
      } finally {
        await signOut(auth).catch(() => {});
        if (button) button.disabled = false;
      }
    });

    ui.resendButton.addEventListener('click', async event => {
      const button = event.currentTarget;
      const email = ui.panel.querySelector('#registerEmail').value.trim();
      if (!email) return ui.setStatus('Informe o e-mail da conta.', true);

      button.disabled = true;
      ui.setStatus('Solicitando novo e-mail de confirmação...');
      try {
        await requestVerification(email);
        ui.setStatus('Se houver um cadastro pendente para este e-mail, uma nova confirmação foi solicitada. Verifique também Spam, Lixo eletrônico e Promoções.');
      } catch (error) {
        console.error('Falha ao reenviar verificação.', error);
        ui.setStatus(verificationMessage(error), true);
      } finally {
        button.disabled = false;
      }
    });
  }
} catch (error) {
  console.error('Módulo de cadastro indisponível.', error);
}
