-- ============================================================
-- FCP-ST (Fundo de Combate à Pobreza sobre a base do ICMS-ST) — valor
-- que vinha na NF-e (vFCPST, por item e no total ICMSTot) mas não era
-- capturado em lugar nenhum: nem gravado, nem somado no custo do produto.
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE nfe_itens    ADD COLUMN IF NOT EXISTS fcp_st NUMERIC(10,2) DEFAULT 0;
ALTER TABLE nfe_entradas ADD COLUMN IF NOT EXISTS valor_fcp_st NUMERIC(10,2) DEFAULT 0;
