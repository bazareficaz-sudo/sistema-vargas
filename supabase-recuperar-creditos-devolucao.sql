-- Recupera os registros de crédito que o PDV tentou gravar em
-- creditos_cliente mas falhou silenciosamente (schema desatualizado).
--
-- Não mexe em clientes.saldo_credito — esse campo já está correto, pois
-- era atualizado numa chamada separada que não dependia do insert que
-- falhava. Aqui só recriamos a "ficha" (linha) do crédito em si.
--
-- Seguro rodar mais de uma vez: só insere créditos de vendas que geraram
-- crédito (vendas.credito_gerado > 0) e que ainda não têm nenhuma linha
-- correspondente em creditos_cliente (usando origem_id = vendas.id).

insert into creditos_cliente (
  empresa_id, cliente_id, valor_original, valor_utilizado,
  origem, origem_id, descricao, status, observacao, operador_nome, created_at
)
select
  v.empresa_id,
  v.cliente_id,
  v.credito_gerado,
  0,
  'devolucao',
  v.id,
  'Devolução no PDV — venda #' || coalesce(v.numero::text, left(v.id::text, 8)) || ' (recuperado)',
  'disponivel',
  'Crédito recuperado — o insert original falhou por incompatibilidade de schema, corrigido no código.',
  v.operador_nome,
  v.created_at
from vendas v
where v.credito_gerado > 0
  and v.cliente_id is not null
  and not exists (
    select 1 from creditos_cliente cc where cc.origem_id = v.id
  );
