-- ============================================================
-- Regime tributário: adiciona "Simples Nacional (excesso de sublimite
-- de receita bruta)" — CRT=2 na tabela oficial SEFAZ, faltava nas opções
-- (antes só existia 1 ou 3 na prática, nunca 2).
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_regime_tributario_check;
ALTER TABLE empresas ADD CONSTRAINT empresas_regime_tributario_check
  CHECK (regime_tributario IN ('simples_nacional','simples_nacional_excesso','lucro_presumido','lucro_real','mei','isento','outro'));
