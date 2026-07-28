-- ============================================================
-- Permite configurar, por empresa, uma OUTRA empresa do mesmo
-- grupo pra debitar o estoque das vendas do PDV interno, e outra
-- (ou a mesma) pra emitir o documento fiscal.
-- NULL (padrão) = comporta-se exatamente como hoje (própria empresa).
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE empresa_config_estoque
  ADD COLUMN IF NOT EXISTS empresa_estoque_id UUID REFERENCES empresas(id);

ALTER TABLE empresa_config_fiscal
  ADD COLUMN IF NOT EXISTS empresa_fiscal_id UUID REFERENCES empresas(id);
