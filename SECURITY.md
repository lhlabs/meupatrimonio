# Segurança — Meu Patrimônio

## Modelo de segurança

O aplicativo é um cliente web/PWA estático hospedado no GitHub Pages. A segurança dos dados privados não depende do JavaScript entregue ao navegador: ela é aplicada pelo Supabase Auth, PostgreSQL e Row Level Security (RLS).

- Cada tabela financeira possui `user_id` referenciando `auth.users(id)`.
- Todas as tabelas expostas do aplicativo têm RLS habilitado e forçado.
- As políticas exigem `(select auth.uid()) = user_id` em `USING` e `WITH CHECK`.
- O papel `anon` não recebe CRUD nas tabelas financeiras.
- O frontend usa somente a URL pública do projeto e uma publishable key `sb_publishable_...`.
- Secret keys `sb_secret_...`, credenciais Firebase Admin, tokens administrativos e arquivos `.env` nunca podem ser enviados ao navegador ou commitados.

## Controles implementados

- isolamento por usuário no PostgreSQL via RLS;
- foreign keys para `auth.users` com `ON DELETE CASCADE`;
- validações de esquema, tipos, categorias, tamanhos e faixas monetárias no banco;
- IDs compatíveis com os documentos históricos do Firestore;
- timestamps de criação e atualização controlados pelo PostgreSQL para operações do PWA;
- preservação de `createdAt` em atualizações;
- sessão do navegador/PWA em `sessionStorage` com renovação automática do token;
- bloqueio da interface após 15 minutos de inatividade;
- senha de cadastro reforçada no cliente para 12+ caracteres com maiúscula, minúscula, número e símbolo;
- confirmação de e-mail e recuperação de senha pelo Supabase Auth;
- exclusão de conta por Edge Function autenticada, com `verify_jwt = true` e chave secreta somente no ambiente do servidor;
- exclusão da conta propagada às tabelas financeiras por `ON DELETE CASCADE`;
- cache PWA restrito aos arquivos estáticos necessários;
- GitHub Actions com menor privilégio e credenciais de checkout não persistidas;
- `.gitignore` cobrindo credenciais e exportações temporárias de migração.

## Configurações obrigatórias no Supabase

Antes do corte de produção, confirme no projeto definitivo:

1. Aplicar todas as migrations em `supabase/migrations/`.
2. Validar os Security Advisors após a aplicação do schema.
3. Manter confirmação de e-mail habilitada no Supabase Auth.
4. Configurar Site URL e Redirect URLs somente para os endereços legítimos do Meu Patrimônio.
5. Manter uma política forte de senha no Auth compatível com a interface.
6. Usar publishable key no frontend; nunca usar secret key no navegador.
7. Implantar `delete-account` com JWT obrigatório.
8. Revisar periodicamente usuários, logs de autenticação, advisors, quotas e faturamento.

## Migração do Firebase

A migração deve ocorrer em uma janela controlada e na seguinte ordem:

1. Criar e proteger o projeto Supabase definitivo.
2. Migrar as contas do Firebase Authentication para o Supabase Auth.
3. Mapear cada usuário pelo e-mail para o UUID criado no Supabase.
4. Migrar `transactions`, `positions`, `planning`, `monthlyGoals`, `recurring` e `scheduled`.
5. Conferir contagens de origem e destino por usuário.
6. Validar autenticação e CRUD com pelo menos duas contas distintas para testar isolamento RLS.
7. Somente depois preencher `supabase-config.js` e promover a branch para produção.

O utilitário em `tools/firebase-to-supabase/` lê credenciais administrativas apenas de variáveis de ambiente. Arquivos de service account e secret keys não pertencem ao repositório.

## Exclusão e privacidade

A interface de Planejamento permite excluir conta e dados. O usuário precisa informar novamente sua senha. Após a reautenticação, a Edge Function identifica o usuário pelo JWT e exclui somente aquela conta no Supabase Auth; as linhas financeiras vinculadas são removidas por cascade no banco.

Nunca permita que o cliente forneça livremente o UUID a ser excluído. A identidade utilizada para exclusão deve sempre vir do JWT validado pelo servidor.

## Resposta a incidente

Se uma credencial administrativa real for exposta:

1. revogar/rotacionar imediatamente a credencial no provedor;
2. remover a credencial do código e de qualquer artefato publicado;
3. considerar o histórico Git comprometido até concluir rotação e limpeza apropriadas;
4. revisar logs de autenticação, banco e funções;
5. avaliar acesso ou alteração indevida de dados;
6. avaliar impacto sobre titulares e obrigações de comunicação aplicáveis.
