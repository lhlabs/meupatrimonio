import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../compat/firebase-auth.js', import.meta.url), 'utf8');
const registration = await readFile(new URL('../registration.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const mobile = await readFile(new URL('../mobile/mobile.js', import.meta.url), 'utf8');
const webSw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const mobileSw = await readFile(new URL('../mobile/sw.js', import.meta.url), 'utf8');

test('auth state callback does not run application async work inside Supabase auth lock', () => {
  assert.match(source, /supabase\.auth\.onAuthStateChange\(\(event, session\) => \{/);
  assert.doesNotMatch(source, /supabase\.auth\.onAuthStateChange\(async\s*\(/);
  assert.match(source, /notifyLocalAuth\(eventUser\);/);
});

test('successful password login notifies application directly', () => {
  assert.match(source, /signInWithEmailAndPassword[\s\S]*?notifyLocalAuth\(signedInUser\);/);
  assert.match(source, /localAuthListeners\.add\(deliver\);/);
});

test('registration module never competes for the login form', () => {
  assert.doesNotMatch(registration, /signInWithEmailAndPassword/);
  assert.doesNotMatch(registration, /loginForm\?\.addEventListener\(['"]submit['"]/);
  assert.match(app, /#loginForm'\)\.addEventListener\('submit'/);
  assert.match(mobile, /#loginForm'\)\.addEventListener\('submit'/);
});

test('initial session snapshot cannot overwrite a newer auth state', () => {
  assert.match(source, /const initialRevision = authRevision;/);
  assert.match(source, /if \(!active \|\| authRevision !== initialRevision\) return;/);
});

test('startup user refresh cannot overwrite a login completed in flight', () => {
  assert.match(source, /const observedRevision = authRevision;/);
  assert.match(source, /if \(authRevision !== observedRevision\) return mapUser\(rawUser\);/);
});

test('service workers bypass stale browser HTTP cache for critical updates', () => {
  for (const sw of [webSw, mobileSw]) {
    assert.match(sw, /cache:'reload'/);
    assert.match(sw, /cache:'no-store'/);
    assert.match(sw, /ignoreSearch:true/);
  }
});


test('web bootstrap uses multi-element selector for forEach handlers', async () => {
  const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const lines = appSource.split('\n').map(line => line.trim());
  const closeBad = "$('[data-close-account-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));";
  const closeGood = "$$('[data-close-account-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));";
  const typeBad = "$('[data-tx-type]').forEach(button => button.classList.toggle('selected', button.dataset.txType === type));";
  const typeGood = "$$('[data-tx-type]').forEach(button => button.classList.toggle('selected', button.dataset.txType === type));";
  assert.equal(lines.includes(closeBad), false);
  assert.equal(lines.includes(typeBad), false);
  assert.equal(lines.includes(closeGood), true);
  assert.equal(lines.includes(typeGood), true);
});
