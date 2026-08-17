-- ============================================================
-- IA DO AUXILIAR DE COMPRAS — fatia 5
--
-- Duas tabelas pequenas, separadas de `reposicao_metricas` de propósito:
-- a IA roda só sobre os 30-40 produtos de maior score, não sobre os 1.200+
-- que o motor calcula toda noite. Se fossem colunas em `reposicao_metricas`,
-- seriam nulas em 97% das linhas para sempre — sinal de que a tabela errada
-- estava guardando a informação.
-- ============================================================

CREATE TABLE IF NOT EXISTS reposicao_ia_sinais (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  produto_id UUID NOT NULL,

  -- [{ tipo: 'aceleracao'|'queda_demanda'|'demanda_perdida'|
  --           'minimo_inadequado'|'excesso_a_liquidar', texto: '...' }]
  sinais     JSONB NOT NULL DEFAULT '[]'::jsonb,

  gerado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, produto_id)
);
ALTER TABLE reposicao_ia_sinais DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_reposicao_ia_sinais_empresa
  ON reposicao_ia_sinais (empresa_id);

-- O card "Análise Inteligente" no topo do Auxiliar de Compras — um resumo
-- por dia, não por produto.
CREATE TABLE IF NOT EXISTS reposicao_ia_resumo (
  empresa_id UUID PRIMARY KEY,
  texto      TEXT NOT NULL,
  produtos_analisados INTEGER NOT NULL DEFAULT 0,
  gerado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE reposicao_ia_resumo DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE reposicao_ia_sinais IS
  'Sinais que o cálculo determinístico (reposicao_metricas) não enxerga sozinho — aceleração, queda de demanda, demanda perdida, mínimo desatualizado, excesso a liquidar. Só existe para os produtos de maior score do dia; ausência de linha não quer dizer nada, só que não entrou na rodada.';
