# Migração do Firebase Authentication para Supabase Auth

A migração de usuários deve ocorrer antes da migração dos dados financeiros.

## Estratégia

Usar a ferramenta oficial/comunitária mantida para migração Firebase → Supabase, preservando usuários e hashes de senha. Não recriar contas manualmente e não exigir troca de senha sem necessidade.

Repositório da ferramenta:
`https://github.com/supabase-community/firebase-to-supabase`

Guia oficial:
`https://supabase.com/docs/guides/platform/migrating-to-supabase/firebase-auth`

## Dados administrativos necessários somente durante a migração

- service account do Firebase (`firebase-service.json`), armazenada apenas localmente;
- parâmetros de hash do Firebase Authentication: `base64_signer_key`, `base64_salt_separator`, `rounds` e `mem_cost`;
- parâmetros da conexão PostgreSQL do projeto Supabase definitivo, obtidos no Connect / Session pooler;
- senha do banco definida na criação do projeto.

Nunca colocar esses valores no frontend, neste repositório ou em issue/PR.

## Ordem

1. Exportar usuários do Firebase Auth para JSON pela ferramenta de migração.
2. Importar os usuários no Supabase Auth conforme o guia oficial.
3. Confirmar quantidade de usuários e e-mails na origem e destino.
4. Testar login com uma conta migrada antes de continuar.
5. Executar `migrate-firestore-data.mjs`; ele associa o UID histórico do Firebase ao UUID do Supabase pelo e-mail normalizado.
6. Somente após Auth + dados validados realizar o corte do frontend.

## Validação mínima

- conta migrada autentica com a senha existente;
- e-mail confirmado mantém estado esperado;
- usuário A não lê nem altera dados do usuário B;
- recuperação de senha funciona no domínio publicado;
- cadastro de nova conta passa a ocorrer exclusivamente no Supabase após o corte.
