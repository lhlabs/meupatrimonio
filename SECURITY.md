# Segurança — Meu Patrimônio

## Modelo de segurança

O Meu Patrimônio é um cliente web/PWA estático hospedado no GitHub Pages. A proteção dos dados privados não depende do JavaScript entregue ao navegador: a autorização efetiva é aplicada por Supabase Auth, PostgreSQL e Row Level Security (RLS).

- Cada tabela financeira possui `user_id` referenciando `auth.users(id)` com `ON DELETE CASCADE`.
- Todas as tabelas financeiras expostas têm RLS habilitado e forçado.
- As políticas exigem `(select auth.uid()) = user_id` em `USING` e `WITH CHECK`.
- O papel `anon` não recebe CRUD nas tabelas financeiras.
- O papel `authenticated` recebe somente `SELECT`, `INSERT`, `UPDATE` e `DELETE`; RLS limita as linhas ao próprio usuário.
- O frontend usa apenas a URL pública do projeto e uma publishable key `sb_publishable_...`.
- Secret keys `sb_secret_...`, service-role keys, credenciais administrativas e arquivos `.env` nunca podem ser enviados ao navegador ou commitados.

## Controles implementados

- isolamento por usuário no PostgreSQL via RLS;
- validações de tipos, categorias, tamanhos, datas e faixas monetárias no banco;
- IDs e contratos de dados compatíveis com a lógica atual do aplicativo;
- timestamps de criação e atualização controlados pelo PostgreSQL para operações do PWA;
- preservação de `createdAt` em atualizações;
- cliente web completo com sessão limitada à sessão do navegador;
- PWA mobile com sessão persistente no dispositivo para manter a experiência de aplicativo instalado;
- encerramento da sessão após 15 minutos de inatividade enquanto o aplicativo está em uso;
- senha de cadastro reforçada na interface para 12+ caracteres com maiúscula, minúscula, número e símbolo;
- confirmação de e-mail e recuperação de senha pelo Supabase Auth;
- exclusão da própria conta por Edge Function: a interface exige nova autenticação por senha e a função valida o JWT do usuário antes de executar a exclusão administrativa;
- exclusão da conta propagada às tabelas financeiras por `ON DELETE CASCADE`;
- endpoint temporário usado durante os testes de migração de usuários do Firebase aposentado e neutralizado;
- PWA e atalhos mobile preservados;
- GitHub Actions com permissões explícitas, testes automatizados e checkout sem persistência de credenciais;
- `.gitignore` cobrindo credenciais, chaves e exportações temporárias.

## Edge Function `delete-account`

O projeto utiliza publishable/secret API keys do modelo atual do Supabase. A função `delete-account` mantém `verify_jwt = false` no gateway e faz a autenticação explicitamente no corpo da função com `auth.getUser(token)`, antes de utilizar a secret key disponível apenas no ambiente da Edge Function. Essa configuração é intencional para o modelo de novas API keys e não torna o endpoint público para operações administrativas: sem um JWT de sessão válido, a exclusão é rejeitada.

Nunca permita que o cliente forneça livremente o UUID a ser excluído. A identidade removida deve vir exclusivamente do JWT validado pelo servidor.

## Estado da migração

Não há requisito de preservar usuários ou dados existentes do Firebase. O Supabase é tratado como a nova fonte de verdade. Arquivos de configuração e regras de implantação do Firebase foram removidos da branch de migração; o nome `firebase-config.js` e os imports históricos permanecem somente como uma camada de compatibilidade interna para evitar alterar a lógica e o fluxo da interface durante a troca de infraestrutura. O import map redireciona esses módulos para implementações baseadas em Supabase, portanto o Firebase SDK não é carregado em produção.

## Configurações de produção

- manter confirmação de e-mail habilitada no Supabase Auth;
- configurar Site URL e Redirect URLs somente para endereços legítimos do Meu Patrimônio;
- manter política forte de senha no Auth alinhada à interface;
- usar somente a publishable key no frontend;
- revisar periodicamente Auth Logs, Edge Function Logs, Security Advisors, quotas e faturamento;
- habilitar Leaked Password Protection no Supabase Auth quando disponível no plano/configuração da conta.

## Resposta a incidente

Se uma credencial administrativa real for exposta:

1. revogar ou rotacionar imediatamente a credencial no provedor;
2. remover a credencial do código e de qualquer artefato publicado;
3. considerar o histórico Git comprometido até concluir a rotação e a limpeza apropriadas;
4. revisar logs de autenticação, banco e funções;
5. avaliar eventual leitura ou alteração indevida de dados;
6. avaliar impacto sobre titulares e obrigações de comunicação aplicáveis.
