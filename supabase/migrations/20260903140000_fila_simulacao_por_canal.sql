-- SIMULACAO POR CANAL. Aplicada em producao em 03/09/2026.
--
-- `marketplace_fila_config.simulacao` e por EMPRESA: liga ou desliga o envio
-- de todos os canais de uma vez. Isso impedia testar o envio real em UM canal
-- mantendo os outros em simulacao.
--
-- NULO = HERDA DA EMPRESA, e por isso a coluna e nulavel em vez de ter
-- default. Um `default false` faria todo canal existente sair de simulacao no
-- momento em que a migracao rodasse — centenas de anuncios recebendo preco e
-- estoque sem ninguem ter pedido.
alter table marketplace_canais
  add column if not exists fila_simulacao boolean;

comment on column marketplace_canais.fila_simulacao is
  'Sobrepoe marketplace_fila_config.simulacao para ESTE canal. true = so simula; false = envia de verdade; NULL = herda a configuracao da empresa.';
