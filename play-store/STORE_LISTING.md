# Meu Patrimônio — preparação Google Play

## Identidade técnica
- Nome do app: Meu Patrimônio
- Package ID: `com.lhlabs.meupatrimonio`
- Versão inicial: `1.0.0` (`versionCode 1`)
- Target SDK: Android 16 / API 36
- Min SDK: API 26
- Categoria sugerida: Finanças
- URL do app web: `https://lhlabs.github.io/meupatrimonio/`
- Política de Privacidade: `https://lhlabs.github.io/meupatrimonio/privacy-policy.html`
- Exclusão externa de conta: `https://lhlabs.github.io/meupatrimonio/delete-account.html`

## Título
Meu Patrimônio

## Descrição curta
Controle receitas, gastos, metas e patrimônio em um só lugar.

## Descrição completa
Meu Patrimônio é um aplicativo de organização financeira pessoal para registrar receitas e despesas, acompanhar o saldo do mês e visualizar a evolução do patrimônio.

Use lançamentos rápidos por texto ou voz, organize categorias, acompanhe contas recorrentes e agendadas, defina metas e mantenha uma visão consolidada dos seus ativos, reservas e dívidas.

Principais recursos:
- registro de receitas e despesas;
- lançamento rápido por texto e voz;
- categorias financeiras;
- contas recorrentes e agendadas;
- metas de gastos e reserva;
- acompanhamento de patrimônio, ativos e dívidas;
- indicadores mensais e anuais;
- exportação de dados disponível na versão completa;
- autenticação individual e dados separados por usuário.

O Meu Patrimônio é uma ferramenta de organização pessoal. Não realiza pagamentos, transferências, concessão de crédito, intermediação de investimentos ou movimentação de valores.

## Segurança dos dados — base para preenchimento
Revisar no Play Console contra a versão final do app e os SDKs efetivamente publicados.

Dados tratados pelo app:
- Informações pessoais: e-mail e identificador de usuário.
- Informações financeiras: receitas, despesas, patrimônio, ativos, reservas, dívidas, metas e demais dados financeiros inseridos pelo próprio usuário.
- Áudio: usado somente quando o usuário aciona ditado; o app não armazena arquivo de áudio, mas o serviço de reconhecimento do dispositivo pode processá-lo.
- Sinais técnicos de segurança: Firebase App Check/reCAPTCHA Enterprise pode tratar sinais do dispositivo/navegador para prevenção de abuso.

Finalidades:
- funcionalidade do app;
- gerenciamento de conta;
- segurança e prevenção contra abuso.

Práticas:
- dados em trânsito por HTTPS;
- sem venda de dados;
- sem publicidade;
- exclusão de conta e dados disponível;
- política pública dentro e fora do app.

## Declaração de funcionalidades financeiras
O app é de organização financeira pessoal. Não oferece empréstimos, serviços bancários, pagamentos, transferências, carteira digital, cripto, corretagem, seguros ou negociação de ativos. No formulário, revisar as opções exibidas pelo Play Console e selecionar somente a categoria que represente organização/gestão financeira pessoal, caso exista; não declarar produtos financeiros que o app não oferece.

## Acesso para revisão do Google Play
Como o conteúdo principal exige login, a Play Console solicitará credenciais de demonstração ativas para a equipe de revisão. Criar uma conta específica de teste sem dados pessoais reais.

## Assinatura do AAB
O workflow `.github/workflows/android.yml` gera APK de debug e AAB de release. Para gerar AAB de release assinado, cadastrar no GitHub Actions os secrets:
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Nunca versionar a chave `.jks` no repositório.
