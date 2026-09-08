-- FASE 0.6B, Portão B — flag por OPERAÇÃO, não global.
-- Aplicada em produção em 08/09/2026 como `pdv_rotas_por_operacao_e_fallback`.

ALTER TABLE pdv_terminais
  ADD COLUMN IF NOT EXISTS rotas_habilitadas JSONB NOT NULL DEFAULT '{}'::jsonb;

-- `usar_rotas_novas` segue valendo SÓ para `impressao.publicar_url`.

-- `legacy_fallback` entra no CHECK: ao contrário de 'legacy_anon', ele É
-- escrito — é o PDV avisando, pela rota autenticada, que precisou do caminho
-- antigo. É o número que autoriza (ou barra) o corte do `anon`.
ALTER TABLE pdv_operacoes DROP CONSTRAINT IF EXISTS pdv_operacoes_metodo_check;
ALTER TABLE pdv_operacoes ADD CONSTRAINT pdv_operacoes_metodo_check
  CHECK (metodo IN ('terminal_token', 'legacy_fallback'));

CREATE INDEX IF NOT EXISTS idx_pdv_operacoes_metodo
  ON pdv_operacoes (empresa_id, operacao, metodo, criado_em DESC);
