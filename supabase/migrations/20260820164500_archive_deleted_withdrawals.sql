alter table public.transactions
  add column if not exists archived boolean not null default false;

comment on column public.transactions.archived is
  'Oculta o efeito de caixa de um lançamento excluído sem desfazer o consumo patrimonial já realizado.';
