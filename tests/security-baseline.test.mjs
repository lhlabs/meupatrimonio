import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const schema = read('supabase/migrations/001_initial_schema.sql');
const timestampGuards = read('supabase/migrations/002_server_timestamp_guards.sql');
const supabaseConfig = read('supabase-config.js');
const supabaseClient = read('supabase-client.js');
const authCompat = read('compat/firebase-auth.js');
const firestoreCompat = read('compat/firebase-firestore.js');
const deleteAccount = read('supabase/functions/delete-account/index.ts');
const hardening = read('security-hardening.js');
const gitignore = read('.gitignore');
const workflow = read('.github/workflows/pages.yml');
const codeql = read('.github/workflows/codeql.yml');
const rootSw = read('sw.js');
const mobileSw = read('mobile/sw.js');

const privateTables = ['transactions', 'positions', 'planning', 'monthlyGoals', 'recurring', 'scheduled'];

test('Supabase ativa e força RLS em todas as tabelas financeiras', () => {
  for (const table of privateTables) {
    const sqlName = table === 'monthlyGoals' ? '"monthlyGoals"' : table;
    assert.match(schema, new RegExp(`alter table public\\.${sqlName.replace(/["\\]/g, '\\$&')} enable row level security`, 'i'));
    assert.match(schema, new RegExp(`alter table public\\.${sqlName.replace(/["\\]/g, '\\$&')} force row level security`, 'i'));
  }
  assert.match(schema, /revoke all on table[\s\S]*from anon;/i);
});

test('RLS limita CRUD ao proprietário autenticado', () => {
  for (const policy of [
    'transactions_owner_only',
    'positions_owner_only',
    'planning_owner_only',
    'monthly_goals_owner_only',
    'recurring_owner_only',
    'scheduled_owner_only'
  ]) {
    assert.ok(schema.includes(`create policy ${policy}`), `política ausente: ${policy}`);
  }
  const ownershipChecks = schema.match(/\(select auth\.uid\(\)\) = user_id/g) || [];
  assert.ok(ownershipChecks.length >= 12, 'USING e WITH CHECK devem validar auth.uid() em todas as políticas');
  assert.match(schema, /for all to authenticated/i);
});

test('Dados financeiros são vinculados a auth.users com cascade delete', () => {
  const references = schema.match(/references auth\.users\(id\) on delete cascade/g) || [];
  assert.equal(references.length, 6);
  assert.match(schema, /user_id uuid not null default auth\.uid\(\)/);
});

test('Banco preserva validações financeiras e IDs graváveis', () => {
  assert.match(schema, /\^\[A-Za-z0-9_-\]\{1,160\}\$/);
  for (const category of ['Moradia', 'Academia', 'Investimentos/Aportes', 'Salário', 'Renda extra', 'Resgate de Patrimônio']) {
    assert.ok(schema.includes(`'${category}'`), `categoria esperada ausente: ${category}`);
  }
  assert.match(schema, /amount > 0 and amount < 100000000/);
  assert.match(schema, /"reserveTargetMonths" between 1 and 24/);
});

test('Timestamps críticos são controlados pelo PostgreSQL', () => {
  assert.match(timestampGuards, /new\."createdAt" = now\(\)/);
  assert.match(timestampGuards, /new\."updatedAt" = now\(\)/);
  for (const table of ['transactions', 'positions', 'monthly_goals', 'recurring', 'scheduled', 'planning']) {
    assert.ok(timestampGuards.toLowerCase().includes(table), `trigger de timestamp ausente para ${table}`);
  }
  assert.match(schema, /new\."createdAt" = old\."createdAt"/);
});

test('Frontend usa apenas URL e publishable key do Supabase', () => {
  assert.match(supabaseConfig, /__SUPABASE_URL__/);
  assert.match(supabaseConfig, /__SUPABASE_PUBLISHABLE_KEY__/);
  assert.match(supabaseConfig, /sb_publishable_/);
  assert.match(supabaseClient, /createClient/);
  assert.match(supabaseClient, /sessionStorage/);
  assert.doesNotMatch(`${supabaseConfig}\n${supabaseClient}`, /service[_-]?role/i);
  assert.doesNotMatch(`${supabaseConfig}\n${supabaseClient}`, /sb_secret_/i);
});

test('Autenticação foi redirecionada para Supabase Auth', () => {
  for (const method of [
    'signInWithPassword',
    'signUp',
    'resend',
    'resetPasswordForEmail',
    'onAuthStateChange',
    'updateUser'
  ]) {
    assert.ok(authCompat.includes(method), `método Supabase ausente: ${method}`);
  }
  assert.match(authCompat, /email not confirmed/);
  assert.match(authCompat, /PASSWORD_RECOVERY/);
});

test('CRUD legado resolve somente para tabelas Supabase conhecidas', () => {
  assert.match(firestoreCompat, /\['transactions','positions','monthlyGoals','recurring','scheduled'\]/);
  assert.match(firestoreCompat, /supabase\.from\(ref\.table\)/);
  assert.match(firestoreCompat, /\.eq\('user_id', ref\.userId\)/);
  assert.match(firestoreCompat, /Coleção não suportada/);
});

test('Exclusão de conta mantém service role somente no servidor', () => {
  assert.match(authCompat, /functions\.invoke\('delete-account'/);
  assert.match(deleteAccount, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(deleteAccount, /auth\.getUser\(token\)/);
  assert.match(deleteAccount, /auth\.admin\.deleteUser\(userData\.user\.id\)/);
  assert.doesNotMatch(authCompat, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('Camada de sessão mantém política forte e encerra por inatividade', () => {
  assert.match(hardening, /browserSessionPersistence/);
  assert.match(hardening, /15\s*\*\s*60\s*\*\s*1000/);
  assert.match(hardening, /signOut\(auth\)/);
  assert.match(hardening, /password\.length\s*>=\s*12/);
  assert.match(hardening, /\[a-z\]/);
  assert.match(hardening, /\[A-Z\]/);
  assert.match(hardening, /\\d/);
  assert.match(hardening, /\[\^A-Za-z0-9\]/);
});

test('PWA inclui a nova camada de infraestrutura no cache de aplicação', () => {
  for (const sw of [rootSw, mobileSw]) {
    assert.match(sw, /supabase-config\.js/);
    assert.match(sw, /supabase-client\.js/);
    assert.match(sw, /compat\/firebase-auth\.js/);
    assert.match(sw, /compat\/firebase-firestore\.js/);
  }
});

test('Arquivos típicos de credenciais privadas permanecem ignorados', () => {
  for (const pattern of ['.env', '*.pem', '*.key', '*.jks', '*.keystore', 'service-account', 'firebase-adminsdk']) {
    assert.ok(gitignore.includes(pattern), `faltando proteção no .gitignore para ${pattern}`);
  }
});

test('CI valida código e executa CodeQL com permissões explícitas', () => {
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(workflow, /node --test tests\/\*\.test\.mjs/);
  assert.match(codeql, /security-events:\s*write/);
  assert.match(codeql, /queries:\s*security-extended/);
  assert.match(codeql, /persist-credentials:\s*false/);
});
