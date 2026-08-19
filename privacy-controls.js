import { getApps, getApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  getAuth,
  EmailAuthProvider,
  reauthenticateWithCredential,
  deleteUser
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const USER_COLLECTIONS = ['transactions', 'positions', 'monthlyGoals', 'recurring', 'scheduled'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function resolveApp() {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (getApps().length) return getApp();
    await sleep(50);
  }
  throw new Error('Firebase indisponível para os controles de privacidade.');
}

async function deleteSnapshotInChunks(db, snapshot) {
  const docs = snapshot.docs.slice();
  while (docs.length) {
    const batch = writeBatch(db);
    docs.splice(0, 400).forEach(item => batch.delete(item.ref));
    await batch.commit();
  }
}

async function deleteFirestoreUserData(db, uid) {
  for (const name of USER_COLLECTIONS) {
    const snapshot = await getDocs(collection(db, 'users', uid, name));
    await deleteSnapshotInChunks(db, snapshot);
  }

  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', uid, 'config', 'planning'));
  batch.delete(doc(db, 'users', uid));
  await batch.commit();
}

function injectPrivacyPanel(deleteHandler) {
  if (document.querySelector('#privacySecurityPanel')) return;
  const planning = document.querySelector('#planningSection');
  if (!planning) return;

  const panel = document.createElement('article');
  panel.id = 'privacySecurityPanel';
  panel.className = 'panel';
  panel.innerHTML = `
    <span class="card-kicker">PRIVACIDADE & SEGURANÇA</span>
    <h2>Controle dos seus dados</h2>
    <p class="muted">Seus dados financeiros ficam vinculados ao identificador da sua conta. Você pode exportar os registros em Excel a qualquer momento.</p>
    <p class="muted">A exclusão abaixo remove os dados conhecidos do Meu Patrimônio no Firestore e, em seguida, exclui a conta de autenticação.</p>
    <button id="deleteMyAccountBtn" type="button" class="ghost-btn">Excluir minha conta e dados</button>
    <div id="privacyStatus" class="muted" role="status" aria-live="polite" style="margin-top:10px"></div>`;
  planning.appendChild(panel);
  panel.querySelector('#deleteMyAccountBtn')?.addEventListener('click', deleteHandler);
}

function setStatus(message, isError = false) {
  const status = document.querySelector('#privacyStatus');
  if (!status) return;
  status.textContent = message;
  status.style.color = isError ? '#ff9aa2' : '';
}

try {
  const app = await resolveApp();
  const auth = getAuth(app);
  const db = getFirestore(app);

  const handleDelete = async event => {
    const button = event.currentTarget;
    const current = auth.currentUser;
    if (!current?.email) return setStatus('Entre novamente antes de excluir a conta.', true);

    const accepted = window.confirm('Esta ação excluirá sua conta e os dados financeiros armazenados pelo Meu Patrimônio. A exclusão não pode ser desfeita. Deseja continuar?');
    if (!accepted) return;

    const password = window.prompt('Para confirmar sua identidade, informe a senha atual da conta:');
    if (!password) return setStatus('Exclusão cancelada. Nenhuma alteração foi realizada.');

    button.disabled = true;
    setStatus('Validando sua identidade e removendo os dados...');
    try {
      const credential = EmailAuthProvider.credential(current.email, password);
      await reauthenticateWithCredential(current, credential);
      await deleteFirestoreUserData(db, current.uid);
      await deleteUser(current);
      window.alert('Conta e dados excluídos com sucesso.');
      window.location.reload();
    } catch (error) {
      console.error('Falha na exclusão da conta.', error);
      const code = String(error?.code || '');
      if (code.includes('invalid-credential') || code.includes('wrong-password')) {
        setStatus('Senha incorreta. Nenhum dado foi excluído antes da validação da identidade.', true);
      } else if (code.includes('requires-recent-login')) {
        setStatus('Sua sessão precisa ser renovada. Saia, entre novamente e repita a exclusão.', true);
      } else {
        setStatus('Não foi possível concluir a exclusão integral. A conta foi mantida quando a remoção não pôde ser concluída com segurança.', true);
      }
    } finally {
      button.disabled = false;
    }
  };

  injectPrivacyPanel(handleDelete);
  const observer = new MutationObserver(() => injectPrivacyPanel(handleDelete));
  observer.observe(document.documentElement, { childList: true, subtree: true });
} catch (error) {
  console.warn('Controles de privacidade indisponíveis.', error);
}
