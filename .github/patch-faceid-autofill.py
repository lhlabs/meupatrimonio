from pathlib import Path

for file in [Path('index.html'), Path('mobile/index.html')]:
    s = file.read_text()
    old_email = '<input id="email" type="email" autocomplete="username" required />'
    new_email = '<input id="email" name="username" type="email" inputmode="email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" required />'
    if old_email not in s:
        raise SystemExit(f'email field pattern not found in {file}')
    s = s.replace(old_email, new_email, 1)
    old_password = '<input id="password" type="password" autocomplete="current-password" required />'
    new_password = '<input id="password" name="password" type="password" autocomplete="current-password" enterkeyhint="go" required />'
    if old_password not in s:
        raise SystemExit(f'password field pattern not found in {file}')
    s = s.replace(old_password, new_password, 1)
    file.write_text(s)

sw = Path('sw.js')
s = sw.read_text()
if "const CACHE='meu-patrimonio-v43';" not in s:
    raise SystemExit('root cache version mismatch')
s = s.replace("const CACHE='meu-patrimonio-v43';", "const CACHE='meu-patrimonio-v44';", 1)
sw.write_text(s)

msw = Path('mobile/sw.js')
s = msw.read_text()
if "const CACHE = 'mp-mobile-v17';" not in s:
    raise SystemExit('mobile cache version mismatch')
s = s.replace("const CACHE = 'mp-mobile-v17';", "const CACHE = 'mp-mobile-v18';", 1)
msw.write_text(s)

Path('tests/faceid-autofill.test.mjs').write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

for (const path of ['../index.html','../mobile/index.html']) {
  test(`login em ${path} expõe metadados compatíveis com gerenciador de senhas`, () => {
    const html = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(html, /id=\"email\" name=\"username\" type=\"email\"[^>]*autocomplete=\"username\"/);
    assert.match(html, /autocapitalize=\"none\"/);
    assert.match(html, /autocorrect=\"off\"/);
    assert.match(html, /spellcheck=\"false\"/);
    assert.match(html, /id=\"password\" name=\"password\" type=\"password\" autocomplete=\"current-password\"/);
  });
}
""")
