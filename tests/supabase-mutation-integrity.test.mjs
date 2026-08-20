import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const firestoreCompat = readFileSync(new URL('../compat/firebase-firestore.js', import.meta.url), 'utf8');

test('updates e deletes confirmam que exatamente um registro foi afetado', () => {
  assert.match(firestoreCompat, /async function requireSingleMutation\(query, ref, operation\)/);
  assert.match(firestoreCompat, /await query\.select\(key\)/);
  assert.match(firestoreCompat, /data\.length !== 1/);
  assert.match(firestoreCompat, /await requireSingleMutation\(query, ref, 'Atualização'\)/);
  assert.match(firestoreCompat, /await requireSingleMutation\(query, ref, 'Exclusão'\)/);
});
