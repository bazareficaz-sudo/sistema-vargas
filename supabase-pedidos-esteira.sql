-- ============================================================
-- ESTEIRA DE PEDIDOS — Fase 1 (etapas, prazos, controle de impressão)
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Situação do ENVIO no canal, separada da situação do pedido.
--    No Mercado Livre o pedido só fala de pagamento; quem diz "nota
--    pendente", "etiqueta pronta" e "etiqueta impressa" é o shipment
--    (/shipments/{id}: status + substatus). Guardado à parte para o sync do
--    pedido não apagar e para a esteira saber em que passo o pedido está
--    mesmo quando a nota ou a etiqueta foram feitas em outro sistema.
ALTER TABLE marketplace_pedidos
  ADD COLUMN IF NOT EXISTS envio_status TEXT,
  ADD COLUMN IF NOT EXISTS envio_substatus TEXT,
  ADD COLUMN IF NOT EXISTS envio_atualizado_em TIMESTAMPTZ;

-- 2. Controle de impressão da etiqueta. Quem imprimiu e quando — é o que
--    move o pedido para "Aguardando postagem" e responde "o que já foi
--    impresso hoje?". Nenhum sync escreve aqui: é registro da operação.
ALTER TABLE marketplace_pedidos
  ADD COLUMN IF NOT EXISTS etiqueta_impressa_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS etiqueta_impressa_por TEXT;

-- 3. A tela carrega os pedidos em aberto de uma vez (sem o teto de 200 que
--    misturava histórico com o que falta enviar).
CREATE INDEX IF NOT EXISTS marketplace_pedidos_empresa_status_data_idx
  ON marketplace_pedidos (empresa_id, status, data_pedido DESC);
