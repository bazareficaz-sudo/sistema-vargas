-- TRANSFERÊNCIA EM LOTE — para o boletim "Chegou na loja".
--
-- Cada item de uma transferência vira uma linha própria em
-- transferencias_estoque, e não havia nada que dissesse "estes 36 itens
-- foram a MESMA transferência". O boletim do Getúlio precisa disso para
-- avisar a loja que recebeu uma vez por remessa, não uma vez por item.
-- lote_id é gerado pelo motor (src/lib/estoque/transferencia.ts) a cada
-- execução; transferências antigas ficam sem lote e fora do boletim.

ALTER TABLE transferencias_estoque ADD COLUMN IF NOT EXISTS lote_id UUID;

CREATE INDEX IF NOT EXISTS idx_transferencias_estoque_lote ON transferencias_estoque (lote_id) WHERE lote_id IS NOT NULL;
-- A rede de segurança do cron procura remessas recentes recebidas pela empresa.
CREATE INDEX IF NOT EXISTS idx_transferencias_estoque_destino_data ON transferencias_estoque (empresa_destino_id, created_at) WHERE lote_id IS NOT NULL;
