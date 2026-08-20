# Migração de dados Firebase → Supabase

Este diretório contém somente a ferramenta de migração dos dados financeiros do Firestore. Credenciais administrativas nunca devem ser commitadas.

## Pré-requisitos

1. O schema em `supabase/migrations/` já deve estar aplicado no projeto Supabase definitivo.
2. As contas do Firebase Authentication já devem existir no Supabase Auth.
3. O mapeamento de dados é feito por e-mail, porque o UUID do usuário no Supabase pode ser diferente do UID histórico do Firebase.
4. Use Node.js 22+.

## Variáveis de ambiente

- `GOOGLE_APPLICATION_CREDENTIALS`: caminho local para o JSON da service account do Firebase.
- `FIREBASE_PROJECT_ID`: opcional; padrão `meupatrimonio-4c878`.
- `SUPABASE_URL`: URL do projeto Supabase definitivo.
- `SUPABASE_SECRET_KEY`: chave `sb_secret_...` do projeto. Somente ambiente local/servidor.
- `MIGRATION_DRY_RUN=1`: valida usuários e lê a origem sem gravar no Supabase.

Compatibilidade temporária: `SUPABASE_SERVICE_ROLE_KEY` também é aceita pelo script, mas projetos novos devem usar `SUPABASE_SECRET_KEY`.

## Procedimento seguro

1. Instale as dependências deste diretório e preserve o lockfile gerado.
2. Exporte as variáveis de ambiente sem salvar segredos no repositório.
3. Execute primeiro com `MIGRATION_DRY_RUN=1`.
4. Corrija qualquer usuário ausente no Supabase Auth antes de prosseguir.
5. Execute a migração real.
6. O script compara as contagens por usuário para `transactions`, `positions`, `monthlyGoals`, `recurring`, `scheduled` e `planning`.
7. Após a validação, remova arquivos de credenciais temporários da máquina.

## Ordem completa do corte

1. Migrar Auth.
2. Migrar dados com este script.
3. Testar duas contas distintas e confirmar o isolamento RLS.
4. Testar CRUD web e mobile.
5. Preencher `supabase-config.js` apenas com URL + publishable key.
6. Publicar somente após todos os testes passarem.
