-- ============================================================
-- Colunas referenciadas pelo código de Entrada por XML (mapeamento e
-- conferência) que nunca foram criadas de verdade no banco — toda gravação
-- que as usava falhava (erro 42703 "column does not exist"), mas como
-- ninguém checava o {error} do Supabase, a tela seguia mostrando "mapeado"
-- localmente sem nada ter sido salvo. Isso fazia o mapeamento manual sumir
-- ao recarregar a página (o auto-mapeamento não usa descricao_sistema,
-- por isso só ele sobrevivia).
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE nfe_itens ADD COLUMN IF NOT EXISTS descricao_sistema TEXT;
ALTER TABLE nfe_itens ADD COLUMN IF NOT EXISTS qtd_conferida NUMERIC(10,3);
ALTER TABLE nfe_itens ADD COLUMN IF NOT EXISTS conferido BOOLEAN DEFAULT false;
ALTER TABLE nfe_itens ADD COLUMN IF NOT EXISTS diferenca_qtd NUMERIC(10,3) DEFAULT 0;
