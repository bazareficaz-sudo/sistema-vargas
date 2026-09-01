-- Credenciais dos provedores de IA. O navegador nunca tem acesso a esta
-- tabela; somente rotas server-side com service_role podem ler ou gravar.
create table if not exists public.ia_provedor_segredos (
  provedor text primary key check (provedor in ('anthropic', 'openai')),
  segredo_cifrado text not null,
  atualizado_por uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.ia_provedor_segredos enable row level security;
revoke all on table public.ia_provedor_segredos from anon, authenticated;

comment on table public.ia_provedor_segredos is
  'Chaves de provedores cifradas no servidor; acesso exclusivo via service_role.';

