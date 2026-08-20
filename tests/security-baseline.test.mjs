import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const schema = read('supabase/migrations/001_initial_schema.sql');
const timestampGuards = read('supabase/migrations/002_server_timestamp_guards.sql');
const hardeningMigration = read('supabase/migrations/20260820111724_harden_financial_integrity_and_permanent_user_rls.sql');
const functionConfig = read('supabase/config.toml');
const supabaseConfig = read('supabase-config.js');
const supabaseClient = read('supabase-client.js');
const authCompat = read('compat/firebase-auth.js');
const firestoreCompat = read('compat/firebase-firestore.js');
const deleteAccount = read('supabase/functions/delete-account/index.ts');
const migrationTool = read('tools/firebase-to-supabase/migrate-firestore-data.mjs');
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
  assert.match(schema, /revoke all on table[\s\S]*from anon, authenticated;/i);
  assert.match(schema, /grant select, insert, update, delete on table[\s\S]*to authenticated;/i);
});

test('RLS limita CRUD ao proprietário autenticado', () => {
  for (const policy of [
    'transactions_owner_only', 'positions_owner_only', 'planning_owner_only',
    'monthly_goals_owner_only', 'recurring_owner_only', 'scheduled_owner_only'
  ]) assert.ok(schema.includes(`create policy ${policy}`), `política ausente: ${policy}`);
  const ownershipChecks = schema.match(/\(select auth\.uid\(\)\) = user_id/g) || [];
  assert.ok(ownershipChecks.length >= 12);
  assert.match(schema, /for all to authenticated/i);
});

test('RLS também bloqueia identidades anônimas e falha fechado sem claim', () => {
  for (const policy of [
    'transactions_permanent_users_only', 'positions_permanent_users_only',
    'planning_permanent_users_only', 'monthly_goals_permanent_users_only',
    'recurring_permanent_users_only', 'scheduled_permanent_users_only'
  ]) assert.ok(hardeningMigration.includes(`create policy ${policy}`), `política restritiva ausente: ${policy}`);
  const restrictive = hardeningMigration.match(/as restrictive for all/g) || [];
  assert.equal(restrictive.length, 6);
  assert.match(hardeningMigration, /auth\.jwt\(\)->>'is_anonymous'/);
  assert.match(hardeningMigration, /coalesce\([\s\S]*true\) = false/);
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

test('Banco valida datas reais, intervalos e vínculo de origem', () => {
  assert.match(hardeningMigration, /transactions_source_pair_valid/);
  assert.match(hardeningMigration, /transactions_date_calendar_valid/);
  assert.match(hardeningMigration, /recurring_start_date_calendar_valid/);
  assert.match(hardeningMigration, /recurring_end_date_calendar_valid/);
  assert.match(hardeningMigration, /recurring_date_range_valid/);
  assert.match(hardeningMigration, /scheduled_due_date_calendar_valid/);
  assert.match(hardeningMigration, /monthly_goals_month_calendar_valid/);
  assert.match(hardeningMigration, /pg_input_is_valid/);
});

test('Timestamps críticos são controlados pelo PostgreSQL para sessões do PWA', () => {
  assert.match(timestampGuards, /auth\.uid\(\) is not null/);
  assert.match(timestampGuards, /new\."createdAt" = now\(\)/);
  assert.match(timestampGuards, /new\."updatedAt" = now\(\)/);
  for (const table of ['transactions', 'positions', 'monthly_goals', 'recurring', 'scheduled', 'planning']) {
    assert.ok(timestampGuards.toLowerCase().includes(table));
  }
  assert.match(schema, /new\."createdAt" = old\."createdAt"/);
});

test('Frontend usa somente URL e publishable key do Supabase', () => {
  assert.match(supabaseConfig, /https:\/\/[a-z0-9]+\.supabase\.co/);
  assert.match(supabaseConfig, /sb_publishable_[A-Za-z0-9_-]+/);
  assert.doesNotMatch(supabaseConfig, /__SUPABASE_(?:URL|PUBLISHABLE_KEY)__/);
  assert.match(supabaseClient, /createClient/);
  assert.match(supabaseClient, /sessionStorage/);
  assert.match(supabaseClient, /localStorage/);
  assert.doesNotMatch(`${supabaseConfig}\n${supabaseClient}`, /service[_-]?role/i);
  assert.doesNotMatch(`${supabaseConfig}\n${supabaseClient}`, /sb_secret_/i);
});

test('Autenticação foi redirecionada para Supabase Auth', () => {
  for (const method of ['signInWithPassword','signUp','resend','resetPasswordForEmail','onAuthStateChange','updateUser']) {
    assert.ok(authCompat.includes(method), `método Supabase ausente: ${method}`);
  }
  assert.match(authCompat, /email not confirmed/);
  assert.match(authCompat, /PASSWORD_RECOVERY/);
});

test('CRUD legado resolve somente para tabelas Supabase conhecidas', () => {
  assert.match(firestoreCompat, /\['transactions','positions','monthlyGoals','recurring','scheduled','wallets','cards'\]/);
  assert.match(firestoreCompat, /supabase\.from\(ref\.table\)/);
  assert.match(firestoreCompat, /\.eq\('user_id', ref\.userId\)/);
  assert.match(firestoreCompat, /Coleção não suportada/);
  assert.doesNotMatch(firestoreCompat, /tableName\(name\)[\s\S]{0,180}return name;[\s\S]{0,120}supabase\.from\(name\)/);
});

test('Exclusão de conta combina gateway JWT, validação do usuário e origem restrita', () => {
  assert.match(authCompat, /functions\.invoke\('delete-account'/);
  assert.match(deleteAccount, /SUPABASE_SECRET_KEYS/);
  assert.match(deleteAccount, /secretKeys\.default/);
  assert.match(deleteAccount, /auth\.getUser\(token\)/);
  assert.match(deleteAccount, /auth\.admin\.deleteUser\(userData\.user\.id\)/);
  assert.match(deleteAccount, /ALLOWED_ORIGINS/);
  assert.match(deleteAccount, /body\?\.confirm !== true/);
  assert.match(deleteAccount, /userData\.user\.is_anonymous/);
  assert.match(functionConfig, /\[functions\.delete-account\][\s\S]*verify_jwt\s*=\s*true/);
  assert.doesNotMatch(authCompat, /SUPABASE_SECRET_KEYS|sb_secret_/);
});

test('Migrador administrativo usa credenciais somente por ambiente e mapeia usuários por e-mail', () => {
  assert.match(migrationTool, /GOOGLE_APPLICATION_CREDENTIALS/);
  assert.match(migrationTool, /SUPABASE_SECRET_KEY/);
  assert.match(migrationTool, /normalizeEmail/);
  assert.match(migrationTool, /supabaseByEmail/);
  assert.match(migrationTool, /user_id: userId/);
  assert.match(migrationTool, /MIGRATION_DRY_RUN/);
  assert.doesNotMatch(migrationTool, /sb_secret_[A-Za-z0-9_-]+/);
});

test('Camada de sessão mantém política forte e encerra por inatividade inclusive no PWA reaberto', () => {
  assert.match(hardening, /15\s*\*\s*60\s*\*\s*1000/);
  assert.match(hardening, /IS_MOBILE_PWA/);
  assert.match(hardening, /localStorage/);
  assert.match(hardening, /sessionStorage/);
  assert.match(hardening, /signOut\(auth\)/);
  assert.match(hardening, /now\(\) - lastActivity >= IDLE_TIMEOUT_MS/);
  assert.match(hardening, /password\.length\s*>=\s*12/);
  assert.match(hardening, /\[a-z\]/);
  assert.match(hardening, /\[A-Z\]/);
  assert.match(hardening, /\\d/);
  assert.match(hardening, /\[\^A-Za-z0-9\]/);
});

test('PWA inclui a infraestrutura Supabase no cache', () => {
  for (const sw of [rootSw, mobileSw]) {
    assert.match(sw, /supabase-config\.js/);
    assert.match(sw, /supabase-client\.js/);
    assert.match(sw, /compat\/firebase-auth\.js/);
    assert.match(sw, /compat\/firebase-firestore\.js/);
  }
});

test('Arquivos de credenciais e exportações de migração permanecem ignorados', () => {
  for (const pattern of ['.env', '*.pem', '*.key', '*.jks', '*.keystore', 'service-account', 'firebase-adminsdk', 'migration-export']) {
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
