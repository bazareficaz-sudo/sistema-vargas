-- Configuração de IA por empresa. Chaves de API permanecem exclusivamente
-- nas variáveis de ambiente do servidor; esta tabela nunca armazena segredos.
create table if not exists public.ia_saas_config (
  id boolean primary key default true check (id),
  provedor_padrao text not null default 'automatico'
    check (provedor_padrao in ('automatico', 'anthropic', 'openai', 'desativado')),
  modelo_padrao text,
  limite_requisicoes_padrao integer not null default 300
    check (limite_requisicoes_padrao = -1 or limite_requisicoes_padrao >= 0),
  limite_tokens_padrao bigint not null default 1000000
    check (limite_tokens_padrao = -1 or limite_tokens_padrao >= 0),
  max_tokens_resposta integer not null default 1200 check (max_tokens_resposta between 100 and 8000),
  timeout_segundos integer not null default 25 check (timeout_segundos between 5 and 90),
  fallback_automatico boolean not null default true,
  atualizado_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.ia_saas_config (id) values (true) on conflict (id) do nothing;

create table if not exists public.ia_empresa_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  habilitado boolean not null default true,
  provedor text not null default 'automatico'
    check (provedor in ('herdar', 'automatico', 'anthropic', 'openai', 'desativado')),
  modelo text,
  limite_requisicoes_mes integer not null default 300
    check (limite_requisicoes_mes = -1 or limite_requisicoes_mes >= 0),
  limite_tokens_mes bigint not null default 1000000
    check (limite_tokens_mes = -1 or limite_tokens_mes >= 0),
  max_tokens_resposta integer not null default 1200
    check (max_tokens_resposta between 100 and 8000),
  timeout_segundos integer not null default 25
    check (timeout_segundos between 5 and 90),
  fallback_automatico boolean not null default true,
  funcionalidades text[] not null default array['dashboard'],
  observacoes text,
  atualizado_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ia_consumo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  usuario_id uuid references auth.users(id) on delete set null,
  request_id uuid not null default gen_random_uuid() unique,
  funcionalidade text not null,
  provedor text not null check (provedor in ('anthropic', 'openai')),
  modelo text not null,
  status text not null check (status in ('sucesso', 'erro', 'bloqueado')),
  tokens_entrada integer not null default 0 check (tokens_entrada >= 0),
  tokens_saida integer not null default 0 check (tokens_saida >= 0),
  tokens_total integer generated always as (tokens_entrada + tokens_saida) stored,
  latencia_ms integer check (latencia_ms is null or latencia_ms >= 0),
  categoria_erro text,
  created_at timestamptz not null default now()
);

create index if not exists ia_consumo_empresa_periodo_idx
  on public.ia_consumo (empresa_id, created_at desc);
create index if not exists ia_consumo_empresa_funcionalidade_periodo_idx
  on public.ia_consumo (empresa_id, funcionalidade, created_at desc);

alter table public.ia_saas_config enable row level security;
alter table public.ia_empresa_config enable row level security;
alter table public.ia_consumo enable row level security;

revoke all on table public.ia_empresa_config from anon, authenticated;
revoke all on table public.ia_consumo from anon, authenticated;
grant select, insert, update on table public.ia_empresa_config to authenticated;
grant select, insert on table public.ia_consumo to authenticated;

create policy "ia_config_admin_select"
  on public.ia_empresa_config for select to authenticated
  using (public.is_system_admin());
create policy "ia_config_admin_insert"
  on public.ia_empresa_config for insert to authenticated
  with check (public.is_system_admin());
create policy "ia_config_admin_update"
  on public.ia_empresa_config for update to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());
create policy "ia_config_empresa_select"
  on public.ia_empresa_config for select to authenticated
  using (empresa_id in (select p.empresa_id from public.profiles p where p.id = (select auth.uid())));

create policy "ia_consumo_admin_select"
  on public.ia_consumo for select to authenticated
  using (public.is_system_admin());
create policy "ia_consumo_empresa_select"
  on public.ia_consumo for select to authenticated
  using (empresa_id in (select p.empresa_id from public.profiles p where p.id = (select auth.uid())));
create policy "ia_consumo_empresa_insert"
  on public.ia_consumo for insert to authenticated
  with check (
    usuario_id = (select auth.uid())
    and empresa_id in (select p.empresa_id from public.profiles p where p.id = (select auth.uid()))
  );

comment on table public.ia_empresa_config is 'Seleção de provedor, modelo e limites de IA por empresa SaaS; não armazena chaves.';
comment on table public.ia_consumo is 'Telemetria de consumo de IA por empresa, sem prompts ou respostas sensíveis.';
revoke all on table public.ia_saas_config from anon, authenticated;
grant select, update on table public.ia_saas_config to authenticated;
create policy "ia_saas_config_read"
  on public.ia_saas_config for select to authenticated using (true);
create policy "ia_saas_config_admin_update"
  on public.ia_saas_config for update to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());
