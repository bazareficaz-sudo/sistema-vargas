-- BAIXA AUTOMÁTICA DO ENDEREÇO
--
-- A venda baixava o saldo do depósito (produto_estoque), mas nunca o do
-- endereço (produto_enderecos): o endereço contado com 13 seguia com 13
-- depois de 5 vendas. Medido em 21/10/2026: 15 dos 56 produtos endereçados
-- marcavam mais do que o depósito tinha, e a tela "Guardar o que chegou"
-- recusava o Confirmar.
--
-- O gatilho fica em produto_estoque, e não em cada tela, porque a saída
-- entra por várias portas: PDV do site, PDV externo (grava direto no banco),
-- marketplace, transferência, ajuste e inventário. Toda saída do depósito
-- sai também dos endereços.
--
-- Quanto sai: o que saiu do depósito — e, se mesmo assim os endereços
-- marcarem mais do que o depósito tem, até caber. Do endereço com MAIS
-- unidades para o com menos. Endereço não fica negativo: o que não couber
-- nos endereços é estoque que já estava sem endereço.
--
-- Nunca bloqueia a venda: qualquer erro aqui vira aviso no log e a
-- atualização do depósito segue.

create or replace function public.enderecos_baixar(
  p_empresa_id uuid, p_deposito_id uuid, p_produto_id uuid,
  p_saiu numeric, p_saldo_deposito numeric, p_motivo text
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_soma numeric;
  v_baixar numeric;
  v_total numeric;
  v_corte numeric;
  v_nome text;
  r record;
begin
  select coalesce(sum(quantidade), 0) into v_soma from produto_enderecos
   where deposito_id = p_deposito_id and produto_id = p_produto_id and quantidade > 0;
  if v_soma <= 0 then return 0; end if;

  v_baixar := least(v_soma, greatest(coalesce(p_saiu, 0), v_soma - greatest(coalesce(p_saldo_deposito, 0), 0)));
  if v_baixar <= 0 then return 0; end if;
  v_total := v_baixar;

  select nome into v_nome from produtos where id = p_produto_id;

  for r in
    select id, endereco_id, quantidade from produto_enderecos
     where deposito_id = p_deposito_id and produto_id = p_produto_id and quantidade > 0
     order by quantidade desc, id
     for update
  loop
    exit when v_baixar <= 0;
    v_corte := least(v_baixar, r.quantidade);
    update produto_enderecos
       set quantidade = r.quantidade - v_corte, ultima_movimentacao = now(), updated_at = now()
     where id = r.id;
    insert into endereco_movimentacoes (
      empresa_id, deposito_id, endereco_origem_id, produto_id, produto_nome, tipo, quantidade,
      quantidade_anterior_origem, quantidade_nova_origem, motivo, usuario
    ) values (
      p_empresa_id, p_deposito_id, r.endereco_id, p_produto_id, v_nome, 'baixa', v_corte,
      r.quantidade, r.quantidade - v_corte, p_motivo, 'sistema'
    );
    v_baixar := v_baixar - v_corte;
  end loop;

  return v_total - v_baixar;
end $$;

revoke all on function public.enderecos_baixar(uuid, uuid, uuid, numeric, numeric, text) from public, anon, authenticated;

create or replace function public.trg_enderecos_baixa_saida()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.quantidade is null or old.quantidade is null or new.quantidade >= old.quantidade then
    return null;
  end if;
  begin
    perform enderecos_baixar(
      new.empresa_id, new.deposito_id, new.produto_id,
      old.quantidade - new.quantidade, new.quantidade,
      'Baixa automática: saiu do depósito (venda, transferência ou ajuste)'
    );
  exception when others then
    raise warning 'baixa automática do endereço falhou (produto %, depósito %): %', new.produto_id, new.deposito_id, sqlerrm;
  end;
  return null;
end $$;

create trigger trg_enderecos_baixa_saida
  after update of quantidade on public.produto_estoque
  for each row execute function public.trg_enderecos_baixa_saida();

-- Acerto único do que já estava acima do depósito (as vendas de antes do
-- gatilho): tira só o excesso, com o mesmo registro no histórico.
select public.enderecos_baixar(
  s.empresa_id, s.deposito_id, s.produto_id, 0, coalesce(pe.quantidade, 0),
  'Acerto: o endereço marcava mais do que o depósito tem (vendas anteriores à baixa automática)'
)
from (
  select empresa_id, deposito_id, produto_id, sum(quantidade) as soma
    from produto_enderecos where quantidade > 0
   group by 1, 2, 3
) s
left join produto_estoque pe on pe.deposito_id = s.deposito_id and pe.produto_id = s.produto_id
where s.soma > coalesce(pe.quantidade, 0);
