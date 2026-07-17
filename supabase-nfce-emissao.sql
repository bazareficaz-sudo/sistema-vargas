-- Emissão de NFC-e a partir da venda do PDV.

ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS ncm  TEXT,
  ADD COLUMN IF NOT EXISTS cest TEXT;

-- vendas.nfce_emitida/nfce_chave/nfce_numero/nfce_serie/nfce_url_pdf já
-- existem desde supabase-migracao-pdv.sql (nunca foram usadas até agora) e
-- continuam sendo os campos principais do resultado da emissão. As colunas
-- abaixo completam o ciclo de vida (status intermediário, protocolo,
-- rejeição, auditoria de qual provider emitiu, e o detalhamento de
-- pagamento — sem isso não dá pra montar o <detPag> de uma venda com
-- pagamento dividido entre mais de uma forma).
ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS nfce_status          TEXT,   -- pendente|autorizada|rejeitada|cancelada|erro|ignorada
  ADD COLUMN IF NOT EXISTS nfce_protocolo       TEXT,
  ADD COLUMN IF NOT EXISTS nfce_xml_url         TEXT,
  ADD COLUMN IF NOT EXISTS nfce_motivo_rejeicao TEXT,
  ADD COLUMN IF NOT EXISTS nfce_provider        TEXT,
  ADD COLUMN IF NOT EXISTS pagamentos           JSONB;  -- [{forma, valor}] — detalhamento do pagamento "múltiplo"
