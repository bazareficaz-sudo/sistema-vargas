-- Mantém clientes.saldo_devedor sempre igual à soma das contas em aberto.
--
-- Diagnóstico: o recebimento feito pelo PDV externo baixa a conta e grava o
-- recebimento, mas nunca toca no cadastro do cliente — o saldo ficava
-- congelado num valor maior que a dívida real. Foi o que fez o NELSON ROQUE
-- ver R$ 629,30 depois de já dever R$ 418,90, e o mesmo tinha acontecido
-- com outros 5 clientes.
--
-- A correção mora no banco, e não na tela, porque quem causa o problema não
-- passa pela tela. Vale para o PDV externo, para o sistema web e para
-- qualquer script futuro.
--
-- Já aplicado em produção em 25/08/2026 (migração
-- sincronizar_saldo_devedor_cliente). Este arquivo é o registro versionado.

create or replace function sincronizar_saldo_devedor_cliente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cliente_antigo uuid := null;
  v_cliente_novo   uuid := null;
  v_pagou          boolean := false;
  v_cliente        uuid;
begin
  if tg_op <> 'INSERT' then v_cliente_antigo := old.cliente_id; end if;
  if tg_op <> 'DELETE' then v_cliente_novo   := new.cliente_id; end if;

  -- Entrou dinheiro nesta conta agora? Serve para carimbar a data do
  -- último pagamento, que hoje também ficava para trás.
  if tg_op = 'UPDATE' then
    v_pagou := coalesce(new.valor_recebido, 0) > coalesce(old.valor_recebido, 0);
  end if;

  -- Recalcula os dois lados: se a conta trocou de cliente, o saldo do
  -- antigo também precisa cair.
  for v_cliente in
    select distinct id
      from unnest(array[v_cliente_antigo, v_cliente_novo]) as t(id)
     where id is not null
  loop
    update clientes c
       set saldo_devedor = coalesce((
             select sum(cr.valor_aberto)
               from contas_receber cr
              where cr.cliente_id = v_cliente
                -- Conta cancelada não é dívida. O extrato já as ignorava;
                -- a ficha do cliente é que somava.
                and cr.status is distinct from 'cancelado'
           ), 0),
           data_ultimo_pagamento = case
             when v_pagou and v_cliente = v_cliente_novo then now()
             else c.data_ultimo_pagamento
           end
     where c.id = v_cliente;
  end loop;

  return null;
end;
$$;

drop trigger if exists z_trg_sincronizar_saldo_devedor on contas_receber;

create trigger z_trg_sincronizar_saldo_devedor
  after insert or update or delete on contas_receber
  for each row
  execute function sincronizar_saldo_devedor_cliente();
