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
  if (code.includes('email-already-in-use')) return 'Já existe uma conta com este e-mail. Entre normalmente ou reenvie a confirmação.';
  if (code.includes('invalid-email')) return 'Informe um e-mail válido.';
  if (code.includes('weak-password')) return 'Use uma senha mais forte, com pelo menos 8 caracteres.';
  if (code.includes('too-many-requests')) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  if (code.includes('operation-not-allowed')) return 'O cadastro por e-mail e senha ainda não está habilitado no Firebase.';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'E-mail ou senha inválidos.';
  if (code.includes('network-request-failed')) return 'Falha de conexão. Verifique sua internet e tente novamente.';
  if (code.includes('unauthorized-domain')) return 'Este endereço do aplicativo não está autorizado no Firebase Authentication.';
  return `Não foi possível concluir a autenticação${code ? ` (${code})` : ''}.`;
}

function verificationMessage(error) {
  const code = String(error?.code || '');
  if (code.includes('too-many-requests')) return 'O Firebase bloqueou novos envios temporariamente por excesso de tentativas. Aguarde alguns minutos e tente novamente.';
  if (code.includes('network-request-failed')) return 'Não foi possível solicitar o e-mail de confirmação por falha de conexão.';
  if (code.includes('unauthorized-continue-uri') || code.includes('unauthorized-domain')) return 'O domínio do aplicativo precisa ser autorizado no Firebase Authentication antes do envio.';
  return `A conta existe, mas o Firebase não confirmou o envio do e-mail${code ? ` (${code})` : ''}.`;
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
      <p class="muted" style="margin:0 0 12px">Cada conta possui um identificador exclusivo. Seus dados financeiros ficam separados dos demais usuários no Firestore.</p>
      <form id="registerForm" autocomplete="on">
        <label>E-mail<input id="registerEmail" type="email" autocomplete="email" maxlength="254" required /></label>
        <label>Senha<input id="registerPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required /></label>
        <label>Confirmar senha<input id="registerPasswordConfirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required /></label>
        <small class="muted" style="display:block;margin:-4px 0 12px">Use no mínimo 8 caracteres e não reutilize senhas de outros serviços.</small>
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
  return { panel, loginForm, resetButton, openButton, resendButton, setStatus, showResend, showLogin, showRegister };
}

async function sendVerification(auth, targetUser) {
  auth.languageCode = 'pt-BR';
  await sendEmailVerification(targetUser);
}

function suppressUnverifiedLoadToast(auth) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  const observer = new MutationObserver(() => {
    const current = auth.currentUser;
    if (current && !current.emailVerified && toast.textContent.includes('Falha ao carregar')) {
      toast.classList.remove('show');
      toast.textContent = '';
    }
  });
  observer.observe(toast, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}

try {
  const app = await resolveApp();
  const auth = getAuth(app);
  const db = getFirestore(app);
  const ui = injectRegistrationUi();
  suppressUnverifiedLoadToast(auth);

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
            ui.showRegister();
            const registerEmail = ui.panel.querySelector('#registerEmail');
            if (registerEmail) registerEmail.value = email;
            ui.showResend(true);

            try {
              await sendVerification(auth, credential.user);
              ui.setStatus('E-mail de confirmação solicitado ao Firebase com sucesso. Verifique também Spam, Lixo eletrônico e Promoções.');
            } catch (verificationError) {
              console.error('Falha ao enviar verificação.', verificationError);
              ui.setStatus(verificationMessage(verificationError), true);
            } finally {
              await signOut(auth).catch(() => {});
            }
            return;
          }
        }
      } catch (error) {
        console.error('Falha de autenticação.', error);
        const toast = document.querySelector('#toast');
        if (toast) {
          toast.textContent = authMessage(error);
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 3200);
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
      ui.showResend(false);
      if (password.length < 8) return ui.setStatus('A senha precisa ter pelo menos 8 caracteres.', true);
      if (password !== confirmation) return ui.setStatus('As senhas não coincidem.', true);
      if (button) button.disabled = true;

      let createdUser = null;
      try {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        createdUser = credential.user;
        await sendVerification(auth, credential.user);
        ui.setStatus('Conta criada e e-mail de confirmação solicitado ao Firebase. Abra o link recebido e depois entre normalmente. Verifique também Spam, Lixo eletrônico e Promoções.');
        ui.showResend(true);
      } catch (error) {
        console.error('Falha ao criar conta ou enviar verificação.', error);
        if (createdUser) {
          ui.setStatus(verificationMessage(error), true);
          ui.showResend(true);
        } else {
          ui.setStatus(authMessage(error), true);
          if (String(error?.code || '').includes('email-already-in-use')) ui.showResend(true);
        }
      } finally {
        await signOut(auth).catch(() => {});
        if (button) button.disabled = false;
      }
    });

    ui.resendButton.addEventListener('click', async event => {
      const button = event.currentTarget;
      const email = ui.panel.querySelector('#registerEmail').value.trim();
      const password = ui.panel.querySelector('#registerPassword').value;
      if (!email) return ui.setStatus('Informe o e-mail da conta.', true);
      if (!password) return ui.setStatus('Informe a senha da conta para reenviar a confirmação.', true);

      button.disabled = true;
      ui.setStatus('Solicitando novo e-mail de confirmação...');
      try {
        const credential = await signInWithEmailAndPassword(auth, email, password);
        if (credential.user.emailVerified) {
          ui.setStatus('Este e-mail já está confirmado. Volte para entrar normalmente.');
          ui.showResend(false);
        } else {
          await sendVerification(auth, credential.user);
          ui.setStatus('Novo e-mail de confirmação solicitado ao Firebase com sucesso. Verifique a caixa de entrada, Spam, Lixo eletrônico e Promoções.');
        }
      } catch (error) {
        console.error('Falha ao reenviar verificação.', error);
        const code = String(error?.code || '');
        ui.setStatus(code.includes('invalid-credential') ? authMessage(error) : verificationMessage(error), true);
      } finally {
        await signOut(auth).catch(() => {});
        button.disabled = false;
      }
    });
  }
} catch (error) {
  console.error('Módulo de cadastro indisponível.', error);
}
