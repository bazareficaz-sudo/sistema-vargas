-- Pedidos de Compra ao Fornecedor
create table if not exists pedidos_compra (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  fornecedor_id uuid,
  numero text,
  status text not null default 'rascunho',
  data_pedido date not null default current_date,
  previsao_entrega date,
  condicao_pagamento text,
  comprador_id uuid,
  observacoes text,
  subtotal numeric(14,2) default 0,
  desconto_geral numeric(14,2) default 0,
  frete numeric(14,2) default 0,
  outras_despesas numeric(14,2) default 0,
  total numeric(14,2) default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists pedidos_compra_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos_compra(id) on delete cascade,
  produto_id uuid not null,
  quantidade numeric(14,4) not null default 0,
  custo_unitario numeric(14,4) not null default 0,
  desconto numeric(14,2) default 0,
  total numeric(14,4) default 0,
  ultimo_custo_ref numeric(14,4),
  custo_medio_ref numeric(14,4),
  observacao text,
  created_at timestamptz default now()
);

-- RLS
alter table pedidos_compra enable row level security;
alter table pedidos_compra_itens enable row level security;

create policy "empresa_pedidos_compra" on pedidos_compra
  using (empresa_id in (select empresa_id from profiles where id = auth.uid()));

create policy "empresa_pedidos_compra_itens" on pedidos_compra_itens
  using (pedido_id in (
    select pc.id from pedidos_compra pc
    join profiles p on p.empresa_id = pc.empresa_id
    where p.id = auth.uid()
  ));

-- Número automático por empresa
create or replace function gerar_numero_pedido_compra()
returns trigger language plpgsql as $$
declare v_num integer;
begin
  select coalesce(max(cast(regexp_replace(numero, '\D','','g') as integer)), 0) + 1
  into v_num
  from pedidos_compra
  where empresa_id = new.empresa_id and numero is not null;
  new.numero := lpad(v_num::text, 6, '0');
  return new;
end;
$$;

create trigger trg_numero_pedido_compra
  before insert on pedidos_compra
  for each row when (new.numero is null)
  execute function gerar_numero_pedido_compra();
