-- ============================================================
-- Fase 8 Shopee: novos campos de regra de preço/estoque
-- - valor_embalagem: soma ao custo do produto antes de calcular o preço
--   (modos formula e shopee_liquido, que partem do custo)
-- - percentual_imposto: dedução percentual sobre o preço de venda, igual
--   a mais uma "comissão" no cálculo de margem líquida (modo shopee_liquido)
-- - estoque_complementar: quantidade somada ao estoque calculado antes de
--   enviar pra Shopee (qualquer modo_estoque != 'nao')
-- - estoque_risco: se o estoque calculado ficar <= este valor, o anúncio é
--   pausado automaticamente no envio em massa
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE marketplace_regras_preco
  ADD COLUMN IF NOT EXISTS valor_embalagem     NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS percentual_imposto  NUMERIC(6,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estoque_complementar INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estoque_risco       INTEGER;
