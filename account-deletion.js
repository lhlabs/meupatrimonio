import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  deleteUser
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const USER_COLLECTIONS = ['monthlyGoals', 'transactions', 'positions', 'recurring', 'scheduled'];

async function deleteSnapshotInChunks(db, snapshot) {
  const docs = snapshot.docs.slice();
  while (docs.length) {
    const batch = writeBatch(db);
    docs.splice(0, 400).forEach(item => batch.delete(item.ref));
    await batch.commit();
  }
}

async function deleteFirestoreUserData(db, uid) {
  const rootRef = doc(db, 'users', uid);
  const root = await getDoc(rootRef);
  if (!root.exists()) return;

  // Exclui primeiro um documento pequeno e protegido. Se as regras publicadas
  // estiverem incompatíveis, o fluxo falha antes de apagar os demais dados.
  const planningBatch = writeBatch(db);
  planningBatch.delete(doc(db, 'users', uid, 'config', 'planning'));
  await planningBatch.commit();

  for (const name of USER_COLLECTIONS) {
    const snapshot = await getDocs(collection(db, 'users', uid, name));
    await deleteSnapshotInChunks(db, snapshot);
  }

  const rootBatch = writeBatch(db);
  rootBatch.delete(rootRef);
  await rootBatch.commit();
}

export async function deleteCurrentUserAccount({ auth, db, password }) {
  const current = auth.currentUser;
  if (!current?.email) throw new Error('AUTH_REQUIRED');
  if (!password) throw new Error('PASSWORD_REQUIRED');

  const credential = EmailAuthProvider.credential(current.email, password);
  await reauthenticateWithCredential(current, credential);
  await deleteFirestoreUserData(db, current.uid);
  await deleteUser(current);
}
