-- AGENTES DE IA — CATALOGO E CONTRATACAO. Aplicada em producao em 02/09/2026.
--
-- Tres tabelas, e a separacao entre elas e a decisao de produto:
--
--   ia_agentes         o CATALOGO. So o dono da plataforma cria, no
--                      saas-admin. A empresa nao cria agente.
--   plano_agentes      quais agentes cada plano oferece, e com que carencia.
--   empresa_agentes    o que a empresa CONTRATOU, e as instrucoes que o
--                      gestor escreveu.
--
-- POR QUE A EMPRESA NAO CRIA: um agente e um recorte do catalogo de consultas
-- mais um prompt. Deixar o cliente montar o proprio significa deixar ele
-- montar um agente ruim — que vai responder mal e ser cobrado do sistema, nao
-- de quem o montou. O gestor escreve as REGRAS DELE (`empresa_agentes.
-- instrucoes`); a estrutura e do catalogo.

create table if not exists ia_agentes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nome text not null,
  area text not null,
  descricao text,
  icone text,
  instrucoes_base text not null default '',
  consultas text[] not null default '{}',
  preco_mensal numeric(10,2) not null default 0,
  publicado boolean not null default false,
  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists plano_agentes (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  agente_id uuid not null references ia_agentes(id) on delete cascade,
  incluso boolean not null default false,
  -- CARENCIA = dias de uso livre a partir da ATIVACAO, nao da assinatura.
  dias_carencia integer not null default 0,
  created_at timestamptz not null default now(),
  unique (plan_id, agente_id)
);

create table if not exists empresa_agentes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  agente_id uuid not null references ia_agentes(id) on delete restrict,
  status text not null default 'teste',
  instrucoes text,
  ativado_em timestamptz not null default now(),
  teste_ate timestamptz,
  cancelado_em timestamptz,
  cancelado_por uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, agente_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'empresa_agentes_status_valido') then
    alter table empresa_agentes add constraint empresa_agentes_status_valido
      check (status in ('teste', 'ativo', 'cancelado'));
  end if;
end $$;

create index if not exists idx_empresa_agentes_empresa on empresa_agentes(empresa_id) where status <> 'cancelado';
create index if not exists idx_plano_agentes_plano on plano_agentes(plan_id);

-- CONSUMO POR AGENTE: `ia_consumo` ja registra por empresa e funcionalidade.
-- Falta saber QUAL agente gastou — agente que ninguem usa nao deveria seguir
-- sendo cobrado, e isso tem de ser descoberto antes do cliente descobrir.
alter table ia_consumo add column if not exists agente_id uuid;

comment on table ia_agentes is 'Catalogo de agentes. So o dono da plataforma cria (saas-admin); a empresa contrata.';
comment on column ia_agentes.consultas is 'Nomes das consultas de src/lib/ia/consultas que este agente alcanca.';
comment on column empresa_agentes.instrucoes is 'Regras escritas pelo gestor. Somadas a instrucoes_base, nunca no lugar dela.';
comment on column plano_agentes.dias_carencia is 'Dias de uso livre contados da ATIVACAO do agente pela empresa.';
