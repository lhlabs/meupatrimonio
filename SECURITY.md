# Segurança — Meu Patrimônio

## Modelo de segurança

O aplicativo é um cliente web/PWA estático. A segurança dos dados privados não depende do JavaScript entregue ao navegador: ela deve ser aplicada por Firebase Authentication, App Check e Firestore Security Rules.

- Dados privados ficam em `users/{uid}/...`.
- As regras devem validar `request.auth.uid == userId`.
- Caminhos não explicitamente autorizados são negados.
- A configuração pública do Firebase Web SDK e a site key do App Check não são credenciais administrativas.
- Chaves privadas, service accounts, tokens administrativos, arquivos `.env` e credenciais reais nunca devem ser commitados.

## Controles implementados no código

- isolamento por UID no Firestore;
- validação de esquema, tipo, tamanho e faixa de valores nas Security Rules;
- timestamps de criação protegidos contra alteração;
- `updatedAt` validado no servidor quando aplicável;
- deny-by-default para caminhos desconhecidos;
- Firebase App Check inicializado com reCAPTCHA Enterprise;
- sessão reduzida para persistência de sessão do navegador/PWA;
- bloqueio por 15 minutos de inatividade;
- senha de cadastro reforçada no cliente para 12+ caracteres com maiúscula, minúscula, número e símbolo;
- exclusão autenticada dos dados conhecidos e da conta;
- cache PWA restrito a arquivos estáticos do aplicativo;
- pipeline GitHub Actions com menor privilégio e credenciais de checkout não persistidas;
- `.gitignore` para reduzir risco de commit acidental de segredos.

## Configurações obrigatórias fora do repositório

Estas proteções não podem ser garantidas apenas pelo GitHub e precisam ser conferidas no Firebase/Google Cloud:

1. Publicar a versão atual de `firestore.rules` no projeto correto.
2. Habilitar enforcement do App Check para Cloud Firestore somente após validar métricas de requisições legítimas.
3. Configurar Password Policy do Firebase Authentication em modo **Enforce**, preferencialmente alinhada à regra do cliente (12+ caracteres e composição forte).
4. Habilitar proteção contra enumeração de e-mail no Firebase Authentication/Identity Platform quando disponível para o projeto.
5. Manter somente os domínios realmente utilizados em Authentication > Authorized domains.
6. Revisar periodicamente usuários, chaves, APIs habilitadas, alertas de uso e faturamento/quota.

## Compatibilidade de contas antigas

As regras mantêm temporariamente uma exceção para contas antigas que já possuíam `users/{uid}` antes da exigência de verificação de e-mail. Mesmo nessa exceção, o UID deve ser o proprietário e o e-mail do perfil precisa coincidir com o token autenticado.

Depois que todas as contas antigas estiverem com e-mail confirmado, remova `legacyRootMatches()` e faça `canUsePrivateData()` exigir somente `owns(userId) && emailVerified()`.

## Exclusão e privacidade

A interface de Planejamento inclui exclusão da conta. Antes de remover dados, o usuário precisa informar novamente a senha. O fluxo remove as coleções conhecidas do usuário, o documento de planejamento, o perfil-raiz e por último a conta do Firebase Authentication.

Se novas coleções privadas forem adicionadas no futuro, elas também devem ser incluídas no fluxo de exclusão em `privacy-controls.js`.

## Resposta a incidente

Se uma credencial administrativa real for exposta:

1. revogar/rotacionar imediatamente a credencial no provedor;
2. remover a credencial do código atual;
3. tratar o histórico Git como comprometido até a limpeza/rotação;
4. revisar logs e atividade do projeto;
5. avaliar impacto sobre titulares e obrigações de comunicação aplicáveis.
