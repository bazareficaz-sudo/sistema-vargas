-- ============================================================
-- Cadastro de produto: monitoramento, descrição p/ marketplace,
-- obs interna e campos fiscais adicionais (ICMS/PIS/COFINS/IPI %)
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS monitorar BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS descricao_marketplace TEXT;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS obs_interna TEXT;

-- Campos fiscais que ainda faltavam (cfop, icms_cst, icms_origem, pis_cst,
-- cofins_cst já existiam desde supabase-migracao-pdv.sql, só não estavam
-- editáveis no cadastro do produto)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS csosn TEXT;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS icms_percentual   NUMERIC(6,4);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pis_percentual    NUMERIC(6,4);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cofins_percentual NUMERIC(6,4);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS ipi_percentual    NUMERIC(6,4);

-- Número de WhatsApp do gestor da empresa, pra receber alertas de
-- movimentação de produtos marcados como "Monitorar produto".
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS numero_gestor TEXT;
