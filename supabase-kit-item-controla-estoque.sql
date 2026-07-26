-- ============================================================
-- Componente de kit sem controle de estoque (ex: parafusos, buchas em
-- kits de cantoneira) — o componente nunca limita o estoque calculado do
-- kit e nunca tem baixa registrada na venda.
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE kit_itens ADD COLUMN IF NOT EXISTS controla_estoque BOOLEAN NOT NULL DEFAULT true;
