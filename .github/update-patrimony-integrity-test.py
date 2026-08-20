from pathlib import Path

path = Path('tests/patrimony-integrity.test.mjs')
text = path.read_text()
old_title = "test('patrimônio atual soma posições manuais e aportes realizados, descontando resgates', () => {"
new_title = "test('patrimônio atual soma ativos e aportes enquanto dívidas ficam informativas', () => {"
if text.count(old_title) != 1:
    raise SystemExit('patrimony test title mismatch')
text = text.replace(old_title, new_title, 1)
old = '  assert.equal(result.netWorth, 26200);'
new = '  assert.equal(result.netWorth, 31200);'
if text.count(old) != 1:
    raise SystemExit('patrimony netWorth expectation mismatch')
text = text.replace(old, new, 1)
path.write_text(text)
