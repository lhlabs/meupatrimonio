import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth as getFirebaseAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createClient } from '@supabase/supabase-js';

for (const name of ['GOOGLE_APPLICATION_CREDENTIALS', 'SUPABASE_URL']) {
  if (!process.env[name]) throw new Error(`Variável obrigatória ausente: ${name}`);
}

const SUPABASE_ADMIN_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!SUPABASE_ADMIN_KEY) {
  throw new Error('Variável obrigatória ausente: SUPABASE_SECRET_KEY');
}
if (!SUPABASE_ADMIN_KEY.startsWith('sb_secret_') && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SECRET_KEY deve ser uma chave secreta sb_secret_...');
}

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'meupatrimonio-4c878';
const DRY_RUN = process.env.MIGRATION_DRY_RUN === '1';
const ALLOW_MISSING_USERS = process.env.ALLOW_MISSING_USERS === '1';
const BATCH_SIZE = 300;

initializeApp({
  credential: applicationDefault(),
  projectId: FIREBASE_PROJECT_ID
});

const firebaseAuth = getFirebaseAuth();
const firestore = getFirestore();
const supabase = createClient(
  process.env.SUPABASE_URL,
  SUPABASE_ADMIN_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  }
);

function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

function normalizeValue(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (typeof child !== 'undefined') result[key] = normalizeValue(child);
    }
    return result;
  }
  return value;
}

async function listAllSupabaseUsers() {
  const users = [];
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < perPage) break;
  }
  return users;
}

async function listAllFirebaseUsers() {
  const users = [];
  let pageToken;
  do {
    const page = await firebaseAuth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

async function readCollection(firebaseUid, collectionName) {
  const snapshot = await firestore
    .collection('users')
    .doc(firebaseUid)
    .collection(collectionName)
    .get();

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...normalizeValue(doc.data())
  }));
}

async function readPlanning(firebaseUid) {
  const snapshot = await firestore
    .collection('users')
    .doc(firebaseUid)
    .collection('config')
    .doc('planning')
    .get();

  return snapshot.exists ? normalizeValue(snapshot.data()) : null;
}

function chunks(rows, size = BATCH_SIZE) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

async function upsertRows(table, rows, onConflict = 'user_id,id') {
  if (!rows.length || DRY_RUN) return;
  for (const batch of chunks(rows)) {
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function countRows(table, userId) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw error;
  return count || 0;
}

async function migrateUser(firebaseUser, supabaseUser) {
  const userId = supabaseUser.id;
  const collections = ['transactions', 'positions', 'monthlyGoals', 'recurring', 'scheduled'];
  const result = { email: firebaseUser.email, firebaseUid: firebaseUser.uid, supabaseUid: userId, counts: {} };

  for (const name of collections) {
    const sourceRows = await readCollection(firebaseUser.uid, name);
    const rows = sourceRows.map(row => ({ user_id: userId, ...row }));
    result.counts[name] = sourceRows.length;
    await upsertRows(name, rows);
  }

  const planning = await readPlanning(firebaseUser.uid);
  result.counts.planning = planning ? 1 : 0;
  if (planning) {
    await upsertRows('planning', [{ user_id: userId, ...planning }], 'user_id');
  }

  if (!DRY_RUN) {
    for (const name of ['transactions', 'positions', 'monthlyGoals', 'recurring', 'scheduled']) {
      const destinationCount = await countRows(name, userId);
      if (destinationCount !== result.counts[name]) {
        throw new Error(`${firebaseUser.email}: contagem divergente em ${name} (${result.counts[name]} origem / ${destinationCount} destino)`);
      }
    }
    const planningCount = await countRows('planning', userId);
    if (planningCount !== result.counts.planning) {
      throw new Error(`${firebaseUser.email}: contagem divergente em planning`);
    }
  }

  return result;
}

async function main() {
  console.log(`Firebase: ${FIREBASE_PROJECT_ID}`);
  console.log(`Supabase: ${process.env.SUPABASE_URL}`);
  console.log(DRY_RUN ? 'Modo: DRY RUN' : 'Modo: MIGRAÇÃO REAL');

  const [firebaseUsers, supabaseUsers] = await Promise.all([
    listAllFirebaseUsers(),
    listAllSupabaseUsers()
  ]);

  const supabaseByEmail = new Map(
    supabaseUsers
      .filter(user => user.email)
      .map(user => [normalizeEmail(user.email), user])
  );

  const candidates = firebaseUsers.filter(user => user.email);
  const missing = candidates.filter(user => !supabaseByEmail.has(normalizeEmail(user.email)));

  console.log(`Usuários Firebase com e-mail: ${candidates.length}`);
  console.log(`Usuários Supabase: ${supabaseUsers.length}`);

  if (missing.length) {
    console.error(`Usuários ainda ausentes no Supabase: ${missing.length}`);
    missing.slice(0, 20).forEach(user => console.error(`- ${user.email} (${user.uid})`));
    if (!ALLOW_MISSING_USERS) {
      throw new Error('Migração de dados interrompida: conclua primeiro a migração do Supabase Auth.');
    }
  }

  const results = [];
  for (const firebaseUser of candidates) {
    const supabaseUser = supabaseByEmail.get(normalizeEmail(firebaseUser.email));
    if (!supabaseUser) continue;
    console.log(`Migrando ${firebaseUser.email}...`);
    results.push(await migrateUser(firebaseUser, supabaseUser));
  }

  const totals = {};
  for (const result of results) {
    for (const [name, count] of Object.entries(result.counts)) {
      totals[name] = (totals[name] || 0) + count;
    }
  }

  console.log('\nResumo:');
  console.log(JSON.stringify({ usersMigrated: results.length, missingUsers: missing.length, totals }, null, 2));
  if (DRY_RUN) console.log('Nenhuma gravação foi realizada porque MIGRATION_DRY_RUN=1.');
}

main().catch(error => {
  console.error('\nMIGRAÇÃO FALHOU');
  console.error(error);
  process.exitCode = 1;
});
