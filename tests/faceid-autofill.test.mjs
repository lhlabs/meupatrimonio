import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

for (const path of ['../index.html','../mobile/index.html']) {
  test(`login em ${path} expõe metadados compatíveis com gerenciador de senhas`, () => {
    const html = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(html, /id="email" name="username" type="email"[^>]*autocomplete="username"/);
    assert.match(html, /autocapitalize="none"/);
    assert.match(html, /autocorrect="off"/);
    assert.match(html, /spellcheck="false"/);
    assert.match(html, /id="password" name="password" type="password" autocomplete="current-password"/);
  });
}
