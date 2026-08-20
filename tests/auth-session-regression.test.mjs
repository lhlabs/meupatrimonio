import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../compat/firebase-auth.js', import.meta.url), 'utf8');
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
