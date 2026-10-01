-- Número interno sequencial dos pedidos de marketplace (exibido como PV-000123).
-- Execute no Supabase → SQL Editor.
create sequence if not exists marketplace_pedidos_numero_interno_seq;
alter table marketplace_pedidos add column if not exists numero_interno bigint;
with o as (
  select id, row_number() over (order by data_pedido, created_at, id) rn
  from marketplace_pedidos where numero_interno is null
)
update marketplace_pedidos p set numero_interno = o.rn from o where o.id = p.id;
select setval('marketplace_pedidos_numero_interno_seq', coalesce((select max(numero_interno) from marketplace_pedidos), 0) + 1, false);
alter table marketplace_pedidos alter column numero_interno set default nextval('marketplace_pedidos_numero_interno_seq');
create unique index if not exists marketplace_pedidos_numero_interno_key on marketplace_pedidos (numero_interno);
