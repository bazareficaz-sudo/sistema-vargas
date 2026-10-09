-- Agendamento da entrega feito no PDV.
--
-- Até aqui a venda guardava só o endereço da entrega (endereco_entrega_id e o
-- texto congelado). O balconista combinava "amanhã de manhã" de boca, e isso
-- não ficava em lugar nenhum — nem para quem separa, nem para quem entrega.
--
-- entrega_agendada_para  dia combinado com o cliente (nulo = sem agendamento)
-- entrega_periodo        manhã, tarde, noite ou qualquer horário
-- entrega_telefone       quem atende na entrega (pode não ser o do cadastro)
--
-- Só colunas novas e anuláveis: as vendas antigas e o PDV desktop não mudam.

ALTER TABLE vendas ADD COLUMN IF NOT EXISTS entrega_agendada_para DATE;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS entrega_periodo TEXT;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS entrega_telefone TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendas_entrega_periodo_check') THEN
    ALTER TABLE vendas ADD CONSTRAINT vendas_entrega_periodo_check
      CHECK (entrega_periodo IS NULL OR entrega_periodo IN ('qualquer', 'manha', 'tarde', 'noite'));
  END IF;
END $$;

-- A futura agenda de entregas consulta "o que sai hoje/amanhã" por empresa.
CREATE INDEX IF NOT EXISTS idx_vendas_entrega_agendada
  ON vendas (empresa_id, entrega_agendada_para)
  WHERE entrega_agendada_para IS NOT NULL;

COMMENT ON COLUMN vendas.entrega_agendada_para IS 'Dia da entrega combinado no PDV. Nulo = sem agendamento.';
COMMENT ON COLUMN vendas.entrega_periodo IS 'Período combinado: qualquer, manha, tarde ou noite.';
COMMENT ON COLUMN vendas.entrega_telefone IS 'Telefone de contato para a entrega, informado no PDV.';
