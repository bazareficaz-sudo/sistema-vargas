-- ============================================================
-- Peso e dimensões do produto — usado na criação de anúncios na
-- Shopee (peso e dimensão de pacote são exigidos por add_item) e
-- reaproveitável no futuro por outras integrações/etiquetas de envio.
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS peso_kg        NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS comprimento_cm NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS largura_cm     NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS altura_cm      NUMERIC(10,2);
