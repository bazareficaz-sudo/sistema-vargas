-- ENTREGAS: baixa da entrega feita.
--
-- A tela Entregas (/dashboard/entregas) lista as vendas com
-- entrega_solicitada que ainda não saíram: as agendadas para o dia, as
-- atrasadas e as sem data. "Entregue" grava quando e quem confirmou; é
-- isso que tira a venda da lista de pendentes.
--
-- Não é um status da venda: a venda continua 'concluida' (o dinheiro e o
-- estoque já foram resolvidos no PDV). Aqui é só a logística.

ALTER TABLE vendas ADD COLUMN IF NOT EXISTS entrega_realizada_em TIMESTAMPTZ;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS entrega_realizada_por UUID;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS entrega_realizada_por_nome TEXT;

-- A tela abre sempre pelas pendentes da empresa.
CREATE INDEX IF NOT EXISTS idx_vendas_entregas_pendentes
  ON vendas (empresa_id, entrega_agendada_para)
  WHERE entrega_solicitada AND entrega_realizada_em IS NULL;

COMMENT ON COLUMN vendas.entrega_realizada_em IS
  'Quando a entrega foi confirmada na tela Entregas. Nulo com entrega_solicitada = entrega pendente.';
COMMENT ON COLUMN vendas.entrega_realizada_por IS 'Usuário que confirmou a entrega.';
COMMENT ON COLUMN vendas.entrega_realizada_por_nome IS 'Nome congelado de quem confirmou a entrega.';
