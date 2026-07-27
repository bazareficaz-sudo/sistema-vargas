-- ============================================================
-- TRIGGER: manter produtos.updated_at sempre em dia
-- Execute no Supabase Dashboard → SQL Editor
--
-- Vários fluxos gravam em produtos (entradas manuais, entradas XML,
-- inventário, preços, PDV/devolução, marketplace) e nem todos setam
-- updated_at manualmente. Em vez de corrigir cada call site, um
-- trigger garante que QUALQUER UPDATE na tabela atualiza o campo —
-- é o que permite ao VargasNexus PDV (e a outros consumidores) fazer
-- sync incremental por data em vez de baixar o catálogo inteiro toda vez.
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at_produtos()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_produtos_updated_at ON produtos;
CREATE TRIGGER trg_produtos_updated_at
BEFORE UPDATE ON produtos
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_produtos();
