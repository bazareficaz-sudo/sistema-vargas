-- ============================================================
-- Empresa emissora da nota fiscal POR CANAL de marketplace
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================
-- Cada canal pode faturar por uma empresa diferente do grupo (o CNPJ da
-- nota precisa ser o mesmo da conta de vendedor no marketplace). Nulo =
-- padrão da conta (Empresas → Fiscal → empresa_fiscal_id). A emissão
-- confere que a empresa escolhida é do mesmo tenant de quem vende
-- (resolverEmitente em src/lib/fiscal/emitirParaVenda.ts).
ALTER TABLE marketplace_canais
  ADD COLUMN IF NOT EXISTS empresa_fiscal_id UUID REFERENCES empresas(id) ON DELETE SET NULL;
