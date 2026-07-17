-- Corrige o caso da empresa "Bazar Eficaz", que ficou com 2 depósitos marcados
-- como principal ("Padrão" e "Principal") — só pode existir 1 por empresa.
-- Decisão: "Padrão" continua principal; "Principal" é desativado.
--
-- Rode este script INTEIRO de uma vez no SQL Editor do Supabase. Ele é
-- seguro para rodar mais de uma vez (idempotente).

do $$
declare
  v_empresa_id uuid;
  v_deposito_ficar uuid;   -- "Padrão" — fica principal
  v_deposito_sair   uuid;  -- "Principal" — é desativado
begin
  select id into v_empresa_id
  from empresas
  where nome ilike '%Bazar Eficaz%' or nome_fantasia ilike '%Bazar Eficaz%'
  limit 1;

  if v_empresa_id is null then
    raise exception 'Empresa "Bazar Eficaz" não encontrada — ajuste o filtro do nome antes de rodar.';
  end if;

  select id into v_deposito_ficar from depositos where empresa_id = v_empresa_id and nome = 'Padrão' limit 1;
  select id into v_deposito_sair  from depositos where empresa_id = v_empresa_id and nome = 'Principal' limit 1;

  if v_deposito_ficar is null or v_deposito_sair is null then
    raise exception 'Não encontrei os dois depósitos ("Padrão" e "Principal") pra essa empresa — confira os nomes exatos antes de rodar.';
  end if;

  -- Estoque real e confiável é produtos.estoque (é o que o PDV, entradas e
  -- todo o resto do sistema usam de verdade) — o estoque por depósito
  -- ("produto_estoque") dos dois depósitos duplicados está desatualizado,
  -- então em vez de somar os dois números (que já estão errados),
  -- realocamos tudo no depósito que fica com base no valor real do produto.
  insert into produto_estoque (empresa_id, deposito_id, produto_id, quantidade)
  select v_empresa_id, v_deposito_ficar, p.id, coalesce(p.estoque, 0)
  from produtos p
  where p.empresa_id = v_empresa_id and p.ativo = true
  on conflict (empresa_id, deposito_id, produto_id)
  do update set quantidade = excluded.quantidade, updated_at = now();

  -- Zera o estoque do depósito que está saindo (não apaga as linhas, só o saldo).
  update produto_estoque
  set quantidade = 0, updated_at = now()
  where deposito_id = v_deposito_sair;

  -- Desativa o depósito duplicado.
  update depositos
  set principal = false, ativo = false, updated_at = now()
  where id = v_deposito_sair;

  -- Garante que o que fica está marcado certo.
  update depositos
  set principal = true, ativo = true, updated_at = now()
  where id = v_deposito_ficar;

  raise notice 'OK — depósito "Padrão" (%) é o principal ativo; "Principal" (%) foi desativado e zerado.', v_deposito_ficar, v_deposito_sair;
end $$;

-- Trava definitiva: impede a partir de agora que qualquer empresa (não só a
-- Bazar Eficaz) tenha mais de um depósito principal ao mesmo tempo. Isso só
-- consegue ser criado depois que a duplicidade acima foi corrigida — se
-- ainda existir alguma empresa com 2 principais, este comando falha e avisa.
create unique index if not exists uniq_deposito_principal_por_empresa
  on depositos (empresa_id)
  where principal = true;
