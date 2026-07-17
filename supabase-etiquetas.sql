-- Módulo de Etiquetas de Produto — Fase 1 (fundação + emissão individual/massa)
-- Etiqueta de PREÇO/PRODUTO para prateleira — não confundir com a etiqueta de
-- ENVIO da Shopee (marketplace_pedido_pacotes), que é outro domínio.

create table if not exists etiqueta_modelos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  nome text not null,
  fabricante text not null default 'personalizada', -- pimaco | colacril | a4_generica | termica | zebra | argox | elgin | brother | personalizada
  tipo_pagina text not null default 'folha',         -- folha | bobina
  largura_mm numeric(6,2) not null default 63.5,
  altura_mm numeric(6,2) not null default 38.1,
  margem_topo_mm numeric(6,2) not null default 10,
  margem_esquerda_mm numeric(6,2) not null default 5,
  espaco_horizontal_mm numeric(6,2) not null default 2,
  espaco_vertical_mm numeric(6,2) not null default 2,
  colunas integer not null default 3,
  linhas integer not null default 7,
  pagina_largura_mm numeric(6,2) not null default 210, -- A4 por padrão
  pagina_altura_mm numeric(6,2) not null default 297,
  orientacao text not null default 'retrato', -- retrato | paisagem
  campos jsonb not null default '[]'::jsonb,  -- lista ordenada de campos exibidos na etiqueta
  ativo boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_etiqueta_modelos_empresa on etiqueta_modelos(empresa_id);
alter table etiqueta_modelos disable row level security;

create table if not exists etiqueta_impressoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  modelo_id uuid references etiqueta_modelos(id) on delete set null,
  modelo_nome text,
  usuario_nome text,
  quantidade_total integer not null default 0,
  produtos jsonb not null default '[]'::jsonb, -- [{produto_id, nome, sku, quantidade}]
  created_at timestamptz default now()
);
create index if not exists idx_etiqueta_impressoes_empresa on etiqueta_impressoes(empresa_id, created_at desc);
alter table etiqueta_impressoes disable row level security;
