-- FASE 0.6B, Etapa B e C — saber que um terminal esta VIVO.
-- Aplicada em producao em 08/09/2026 como `pdv_heartbeat_e_versao_minima`.
--
-- A 0.6A mostrou o buraco: `ativado` nao quer dizer `online`. Um terminal
-- podia passar 11h30 sem produzir sinal nenhum, porque o token continuava
-- valido e a renovacao so falava com o servidor perto de vencer.

ALTER TABLE pdv_terminais
  ADD COLUMN IF NOT EXISTS ultimo_heartbeat_em TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pdv_terminais_heartbeat
  ON pdv_terminais (empresa_id, ultimo_heartbeat_em DESC NULLS LAST);

-- NULO = SEM MINIMO. Nesta fase so alimenta relatorio: nada e recusado por
-- versao e nenhuma venda e bloqueada.
ALTER TABLE empresa_config_pdv
  ADD COLUMN IF NOT EXISTS versao_minima_pdv TEXT;
