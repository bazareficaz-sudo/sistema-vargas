-- ============================================================
-- Reforma tributária (IBS/CBS) — cadastro/rastreio interno
-- Execute no Supabase Dashboard → SQL Editor
--
-- Escopo: apenas guardar a informação por produto (CST/classificação
-- e alíquotas). Não há cálculo automático nem emissão de documento
-- fiscal — o sistema hoje não emite NF-e/NFC-e, só importa XML de
-- fornecedores. Validar sempre com a contabilidade da empresa antes
-- de usar esses dados para apuração real.
-- ============================================================

ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS ibs_cst        TEXT,             -- Código de Situação Tributária do IBS/CBS
  ADD COLUMN IF NOT EXISTS ibs_cclasstrib TEXT,             -- Classificação Tributária (cClassTrib) — complementa o CST
  ADD COLUMN IF NOT EXISTS ibs_aliquota   NUMERIC(6,4),     -- Alíquota IBS (%)
  ADD COLUMN IF NOT EXISTS cbs_aliquota   NUMERIC(6,4);     -- Alíquota CBS (%)
