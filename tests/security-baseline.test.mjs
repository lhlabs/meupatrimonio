import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const rules = read('firestore.rules');
const firebaseConfig = JSON.parse(read('firebase.json'));
const firebaseRc = JSON.parse(read('.firebaserc'));
const app = read('app.js');
const mobile = read('mobile/mobile.js');
const hardening = read('security-hardening.js');
const gitignore = read('.gitignore');
const workflow = read('.github/workflows/pages.yml');
const codeql = read('.github/workflows/codeql.yml');

const privateCollections = ['transactions', 'positions', 'monthlyGoals', 'recurring', 'scheduled'];

test('Firestore mantém isolamento por UID e deny by default', () => {
  assert.match(rules, /function\s+owns\(userId\)\s*\{[^}]*request\.auth\.uid\s*==\s*userId/s);
  assert.match(rules, /match\s+\/users\/\{userId\}/);
  for (const collection of privateCollections) {
    assert.match(rules, new RegExp(`match\\s+\\/${collection}\\/\\{[^}]+\\}`));
  }
  assert.match(rules, /match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s*false;\s*\}/s);
  assert.doesNotMatch(rules, /allow\s+read,\s*write:\s*if\s*true/);
});

test('Firestore exige autenticação para dados privados', () => {
  assert.match(rules, /function\s+signedIn\(\)\s*\{\s*return\s+request\.auth\s*!=\s*null;\s*\}/s);
  assert.match(rules, /function\s+canUsePrivateData\(userId\)/);
  assert.match(rules, /emailVerified\(\)/);
});

test('Firestore limita categorias e IDs graváveis para reduzir manipulação e injeção', () => {
  assert.match(rules, /function\s+validDocumentId\(v\).*\^\[A-Za-z0-9_-\]\{1,160\}\$/s);
  assert.match(rules, /function\s+validBaseCategory\(type, category\)/);
  for (const category of ['Moradia', 'Academia', 'Investimentos/Aportes', 'Salário', 'Renda extra', 'Outros']) {
    assert.ok(rules.includes(`'${category}'`), `categoria esperada ausente: ${category}`);
  }
  assert.match(rules, /type\s*==\s*'income'\s*&&\s*category\s*==\s*'Resgate de Patrimônio'/);
  for (const id of ['txId', 'positionId', 'recurringId', 'scheduledId']) {
    assert.match(rules, new RegExp(`validDocumentId\\(${id}\\)`));
  }
  assert.doesNotMatch(rules, /request\.resource\.data\.category\s+is\s+string\s+&&\s+request\.resource\.data\.category\.size\(\)\s*>\s*0/);
});

test('Firebase CLI usa exatamente as rules versionadas neste repositório', () => {
  assert.equal(firebaseConfig.firestore?.rules, 'firestore.rules');
  assert.equal(firebaseRc.projects?.default, 'meupatrimonio-4c878');
});

test('Web e mobile inicializam App Check', () => {
  for (const source of [app, mobile]) {
    assert.match(source, /initializeAppCheck/);
    assert.match(source, /ReCaptchaEnterpriseProvider/);
    assert.match(source, /isTokenAutoRefreshEnabled:\s*true/);
  }
});

test('Camada de sessão reduz persistência e encerra por inatividade', () => {
  assert.match(hardening, /browserSessionPersistence/);
  assert.match(hardening, /setPersistence\(auth,\s*browserSessionPersistence\)/);
  assert.match(hardening, /15\s*\*\s*60\s*\*\s*1000/);
  assert.match(hardening, /signOut\(auth\)/);
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
