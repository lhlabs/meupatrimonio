import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../compat/firebase-auth.js', import.meta.url), 'utf8');

test('auth state callback does not run application async work inside Supabase auth lock', () => {
  assert.match(source, /supabase\.auth\.onAuthStateChange\(\(event, session\) => \{/);
  assert.doesNotMatch(source, /supabase\.auth\.onAuthStateChange\(async\s*\(/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*?deliver\(eventUser\);[\s\S]*?\}, 0\);/);
});

test('initial session snapshot cannot overwrite a newer auth event', () => {
  assert.match(source, /let authEventSeen = false;/);
  assert.match(source, /if \(!active \|\| authEventSeen\) return;/);
  assert.match(source, /authEventSeen = true;/);
});

test('startup user refresh cannot overwrite a login completed in flight', () => {
  assert.match(source, /const observedUser = rawUser;/);
  assert.match(source, /if \(rawUser !== observedUser\) return mapUser\(rawUser\);/);
});
