-- Data em que o dinheiro entrou, que nem sempre é a data em que alguém
-- lançou no sistema. Recebimento de sábado registrado na segunda tem que
-- aparecer no extrato como sábado.
--
-- Fica nulo no histórico já existente; quem lê usa data_recebimento quando
-- existe e created_at quando não existe.

ALTER TABLE recebimentos ADD COLUMN IF NOT EXISTS data_recebimento DATE;

CREATE INDEX IF NOT EXISTS idx_recebimentos_data
  ON recebimentos (empresa_id, data_recebimento);
