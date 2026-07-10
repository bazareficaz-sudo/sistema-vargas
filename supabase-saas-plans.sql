-- ─── SaaS Plans Architecture ──────────────────────────────────────────────────

-- Plans definition
create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  codigo text not null unique,
  descricao text,
  preco_mensal numeric(10,2) default 0,
  preco_anual numeric(10,2) default 0,
  permite_trial boolean default true,
  dias_trial integer default 14,
  exige_pagamento_inicial boolean default false,
  publico boolean default true,
  ativo boolean default true,
  recomendado boolean default false,
  ordem integer default 0,
  cor text default '#3b82f6',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Which modules each plan unlocks
create table if not exists plan_modules (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  modulo text not null,
  unique(plan_id, modulo)
);

-- Quantitative limits per plan (-1 = unlimited)
create table if not exists plan_limits (
  plan_id uuid primary key references plans(id) on delete cascade,
  max_empresas integer default 1,
  max_usuarios integer default 3,
  max_produtos integer default 5000,
  max_clientes integer default 1000,
  max_fornecedores integer default 200,
  max_depositos integer default 1,
  max_canais integer default 0,
  max_vendas_mes integer default -1,
  max_nfce_mes integer default 500,
  max_nfe_mes integer default 0,
  max_whatsapp_mes integer default 0,
  storage_mb integer default 1000,
  permite_api boolean default false,
  permite_pdv_offline boolean default false,
  permite_suporte_prioritario boolean default false
);

-- Subscription: one per empresa, links to a plan
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade unique,
  plan_id uuid not null references plans(id),
  status text not null default 'trial',
  -- status: trial | active | pending | expired | suspended | cancelled | blocked
  data_inicio date not null default current_date,
  data_fim date,
  trial_inicio date default current_date,
  trial_fim date default (current_date + interval '14 days'),
  observacoes text,
  plano_personalizado boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Audit trail for subscription changes
create table if not exists subscription_history (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  plan_id uuid,
  subscription_id uuid references subscriptions(id),
  evento text not null,
  status_anterior text,
  status_novo text,
  plano_anterior text,
  plano_novo text,
  observacao text,
  executado_por uuid,
  created_at timestamptz default now()
);

-- SaaS system admins (owners / operators)
create table if not exists system_admins (
  id uuid primary key,
  nome text,
  email text,
  nivel text default 'admin', -- superadmin | admin | suporte
  ativo boolean default true,
  created_at timestamptz default now()
);

-- Tenant usage counters (refreshed monthly for monthly counters)
create table if not exists tenant_usage (
  empresa_id uuid primary key references empresas(id) on delete cascade,
  total_usuarios integer default 0,
  total_produtos integer default 0,
  total_clientes integer default 0,
  total_fornecedores integer default 0,
  total_depositos integer default 1,
  total_canais integer default 0,
  nfce_mes integer default 0,
  nfe_mes integer default 0,
  whatsapp_mes integer default 0,
  mes_referencia text default to_char(current_date, 'YYYY-MM'),
  updated_at timestamptz default now()
);

-- ─── RLS Policies ─────────────────────────────────────────────────────────────

alter table plans enable row level security;
alter table plan_modules enable row level security;
alter table plan_limits enable row level security;
alter table subscriptions enable row level security;
alter table subscription_history enable row level security;
alter table system_admins enable row level security;
alter table tenant_usage enable row level security;

-- Helper function: is current user a system admin?
create or replace function is_system_admin()
returns boolean language sql security definer as $$
  select exists(select 1 from system_admins where id = auth.uid() and ativo = true);
$$;

-- Plans: public read, system admin write
create policy "plans_public_read" on plans for select using (ativo = true);
create policy "plans_admin_all" on plans for all using (is_system_admin());

create policy "plan_modules_read" on plan_modules for select using (true);
create policy "plan_modules_admin" on plan_modules for all using (is_system_admin());

create policy "plan_limits_read" on plan_limits for select using (true);
create policy "plan_limits_admin" on plan_limits for all using (is_system_admin());

-- Subscriptions: tenant can read own, admin can do all
create policy "subscriptions_tenant_read" on subscriptions for select using (
  empresa_id in (select empresa_id from profiles where id = auth.uid())
  or is_system_admin()
);
create policy "subscriptions_admin_write" on subscriptions for all using (is_system_admin());
-- Allow insert when creating new subscription for own empresa
create policy "subscriptions_self_insert" on subscriptions for insert with check (
  empresa_id in (select empresa_id from profiles where id = auth.uid())
);

create policy "system_admins_self_read" on system_admins for select using (id = auth.uid() or is_system_admin());
create policy "system_admins_superadmin_write" on system_admins for all using (
  exists(select 1 from system_admins where id = auth.uid() and nivel = 'superadmin' and ativo = true)
);

create policy "tenant_usage_read" on tenant_usage for select using (
  empresa_id in (select empresa_id from profiles where id = auth.uid())
  or is_system_admin()
);
create policy "tenant_usage_write" on tenant_usage for all using (is_system_admin());

create policy "sub_history_admin" on subscription_history for all using (is_system_admin());

-- ─── Seed default plans ────────────────────────────────────────────────────────

insert into plans (nome, codigo, descricao, preco_mensal, preco_anual, permite_trial, dias_trial, publico, ativo, recomendado, ordem, cor)
values
  ('Starter',      'starter',      'Ideal para pequenos negócios',    97,  970,  true, 14, true, true, false, 1, '#6366f1'),
  ('Professional', 'professional', 'Para empresas em crescimento',    197, 1970, true, 14, true, true, true,  2, '#3b82f6'),
  ('Enterprise',   'enterprise',   'Para grandes operações e redes',  397, 3970, true, 14, true, true, false, 3, '#8b5cf6')
on conflict (codigo) do nothing;

-- Starter modules
insert into plan_modules (plan_id, modulo)
select p.id, m.modulo from plans p,
  (values
    ('dashboard'),('pdv'),('vendas'),('orcamentos'),
    ('produtos'),('clientes'),('fornecedores'),('categorias'),('marcas'),('vendedores'),
    ('estoque'),('entradas'),('depositos'),('inventario'),
    ('financeiro'),('contas_pagar'),('contas_receber'),
    ('relatorios'),('precos'),('usuarios')
  ) as m(modulo)
where p.codigo = 'starter'
on conflict (plan_id, modulo) do nothing;

-- Professional modules
insert into plan_modules (plan_id, modulo)
select p.id, m.modulo from plans p,
  (values
    ('dashboard'),('pdv'),('vendas'),('orcamentos'),
    ('produtos'),('clientes'),('fornecedores'),('categorias'),('marcas'),('vendedores'),
    ('estoque'),('entradas'),('pedidos_compra'),('depositos'),('inventario'),
    ('financeiro'),('contas_pagar'),('contas_receber'),
    ('relatorios'),('relatorios_avancados'),
    ('marketplace'),('whatsapp'),
    ('precos'),('usuarios'),('multiempresa'),('configuracoes')
  ) as m(modulo)
where p.codigo = 'professional'
on conflict (plan_id, modulo) do nothing;

-- Enterprise modules (all)
insert into plan_modules (plan_id, modulo)
select p.id, m.modulo from plans p,
  (values
    ('dashboard'),('pdv'),('vendas'),('orcamentos'),
    ('produtos'),('clientes'),('fornecedores'),('categorias'),('marcas'),('vendedores'),
    ('estoque'),('entradas'),('pedidos_compra'),('depositos'),('inventario'),
    ('financeiro'),('contas_pagar'),('contas_receber'),
    ('relatorios'),('relatorios_avancados'),
    ('marketplace'),('whatsapp'),
    ('precos'),('usuarios'),('multiempresa'),('configuracoes'),('api')
  ) as m(modulo)
where p.codigo = 'enterprise'
on conflict (plan_id, modulo) do nothing;

-- Starter limits
insert into plan_limits values
  ((select id from plans where codigo='starter'), 1, 3, 5000, 1000, 200, 1, 0, -1, 500, 0, 0, 1000, false, false, false)
on conflict (plan_id) do nothing;

-- Professional limits
insert into plan_limits values
  ((select id from plans where codigo='professional'), 3, 10, 50000, 10000, 1000, 5, 5, -1, -1, 100, 1000, 5000, false, true, false)
on conflict (plan_id) do nothing;

-- Enterprise limits (unlimited everywhere)
insert into plan_limits values
  ((select id from plans where codigo='enterprise'), -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, true, true, true)
on conflict (plan_id) do nothing;

-- ─── Trigger: auto-create subscription when empresa is created ─────────────────
-- (optional helper — can also be done in application code)

-- ─── View for SaaS admin dashboard ───────────────────────────────────────────
create or replace view v_subscriptions_admin as
select
  s.id as subscription_id,
  s.empresa_id,
  e.nome as empresa_nome,
  s.plan_id,
  p.nome as plan_nome,
  p.codigo as plan_codigo,
  s.status,
  s.data_inicio,
  s.data_fim,
  s.trial_inicio,
  s.trial_fim,
  s.plano_personalizado,
  case
    when s.status = 'trial' then greatest(0, (s.trial_fim - current_date)::integer)
    when s.status = 'active' and s.data_fim is not null then greatest(0, (s.data_fim - current_date)::integer)
    else null
  end as dias_restantes,
  s.created_at
from subscriptions s
join empresas e on e.id = s.empresa_id
join plans p on p.id = s.plan_id;
