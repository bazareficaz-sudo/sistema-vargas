-- ============================================================
-- MOTOR DE REPOSIÇÃO — Auxiliar de Compras (fatia 2)
--
-- Duas tabelas: as regras (uma linha por empresa) e o resultado do
-- cálculo (uma linha por produto).
--
-- POR QUE MATERIALIZAR. A tela de Estoque & Giro que já existe lê os
-- 14.281 produtos ativos e recalcula tudo a cada abertura. Com mais
-- janelas de venda, giro, ABC, ponto de reposição e cruzamento com
-- faltas e pedidos em aberto, isso deixa de ser lento e passa a ser
-- inviável. O cálculo roda fora da hora do usuário e a tela só lê.
-- ============================================================

-- ── Regras, por empresa ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS reposicao_config (
  empresa_id UUID PRIMARY KEY,

  -- Para quantos dias de venda a compra deve durar.
  cobertura_alvo_dias      INTEGER NOT NULL DEFAULT 45,
  -- Colchão para o atraso do fornecedor e para o pico de demanda.
  estoque_seguranca_dias   INTEGER NOT NULL DEFAULT 7,
  -- Usado enquanto não houver prazo real medido por fornecedor.
  lead_time_padrao_dias    INTEGER NOT NULL DEFAULT 7,

  -- Quanto o passado recente pesa contra a média longa. 0.7 = 70% das
  -- últimas semanas, 30% do histórico. Produto de ferragem muda de
  -- ritmo por obra na vizinhança, não por sazonalidade de calendário —
  -- por isso o recente pesa mais aqui do que pesaria num varejo de moda.
  peso_vendas_recentes     NUMERIC(3,2) NOT NULL DEFAULT 0.70,

  -- Faixas de cobertura (em dias de venda).
  cobertura_critica_dias   INTEGER NOT NULL DEFAULT 7,
  cobertura_atencao_dias   INTEGER NOT NULL DEFAULT 20,
  cobertura_excesso_dias   INTEGER NOT NULL DEFAULT 180,
  dias_sem_venda_parado    INTEGER NOT NULL DEFAULT 90,

  -- O que entra na conta.
  considerar_faltas          BOOLEAN NOT NULL DEFAULT true,
  considerar_encomendas      BOOLEAN NOT NULL DEFAULT true,
  considerar_pedidos_abertos BOOLEAN NOT NULL DEFAULT true,
  considerar_marketplace     BOOLEAN NOT NULL DEFAULT true,
  considerar_outros_depositos BOOLEAN NOT NULL DEFAULT true,

  -- Produto sem venda nenhuma no período E sem falta registrada não
  -- gera recomendação, mesmo com estoque zero. Sem esta trava o módulo
  -- mandaria comprar 13.870 itens no primeiro dia — que é exatamente o
  -- número de produtos ativos hoje com estoque zerado no cadastro.
  exigir_sinal_de_demanda  BOOLEAN NOT NULL DEFAULT true,

  atualizado_em TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE reposicao_config DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE reposicao_config IS
  'Regras de reposição por empresa. Uma linha por empresa; a ausência da linha vale como os padrões acima.';

-- ── Resultado do cálculo, por produto ────────────────────────
CREATE TABLE IF NOT EXISTS reposicao_metricas (
  empresa_id UUID NOT NULL,
  produto_id UUID NOT NULL,

  -- Demanda medida
  vendas_7    NUMERIC(12,3) NOT NULL DEFAULT 0,
  vendas_15   NUMERIC(12,3) NOT NULL DEFAULT 0,
  vendas_30   NUMERIC(12,3) NOT NULL DEFAULT 0,
  vendas_60   NUMERIC(12,3) NOT NULL DEFAULT 0,
  vendas_90   NUMERIC(12,3) NOT NULL DEFAULT 0,
  vendas_180  NUMERIC(12,3) NOT NULL DEFAULT 0,
  media_diaria         NUMERIC(12,4) NOT NULL DEFAULT 0,
  media_diaria_recente NUMERIC(12,4) NOT NULL DEFAULT 0,
  -- Quanto o recente destoa do histórico. 1.82 = vendendo 82% mais.
  tendencia   NUMERIC(6,2),
  dias_sem_venda INTEGER,
  ultima_venda   TIMESTAMPTZ,

  -- Situação
  estoque_atual     NUMERIC(12,3) NOT NULL DEFAULT 0,
  estoque_minimo    NUMERIC(12,3) NOT NULL DEFAULT 0,
  estoque_outros_depositos NUMERIC(12,3) NOT NULL DEFAULT 0,
  pedido_aberto_qtd NUMERIC(12,3) NOT NULL DEFAULT 0,

  -- Sinais do balcão
  faltas_abertas       INTEGER NOT NULL DEFAULT 0,
  encomendas_abertas   INTEGER NOT NULL DEFAULT 0,
  unidades_solicitadas NUMERIC(12,3) NOT NULL DEFAULT 0,

  -- Conta
  cobertura_dias      INTEGER,          -- NULL = sem giro, não é zero
  previsao_ruptura    DATE,
  lead_time_dias      INTEGER,
  estoque_seguranca   NUMERIC(12,3) NOT NULL DEFAULT 0,
  ponto_reposicao     NUMERIC(12,3) NOT NULL DEFAULT 0,
  sugestao_quantidade NUMERIC(12,3) NOT NULL DEFAULT 0,
  custo_estimado      NUMERIC(14,2)  NOT NULL DEFAULT 0,

  -- Veredito
  score      INTEGER NOT NULL DEFAULT 0,
  prioridade TEXT    NOT NULL DEFAULT 'sem_urgencia',
  classe_abc TEXT,
  giro       TEXT,
  -- Lista dos porquês, na ordem em que devem ser lidos. É o que
  -- responde "por que este produto apareceu aqui" sem passar por IA:
  -- são fatos, e fato não precisa de modelo.
  motivos    JSONB NOT NULL DEFAULT '[]'::jsonb,

  calculado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, produto_id)
);
ALTER TABLE reposicao_metricas DISABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN reposicao_metricas.cobertura_dias IS
  'Dias que o estoque atual dura no ritmo de venda. NULL quando não há venda no período — sem giro é diferente de cobertura zero.';
COMMENT ON COLUMN reposicao_metricas.prioridade IS
  'critico | comprar | analisar | saudavel | excesso | sem_giro | sem_dados';

-- A tela sempre pede o mesmo: desta empresa, o de maior score primeiro.
CREATE INDEX IF NOT EXISTS idx_repo_metricas_score
  ON reposicao_metricas (empresa_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_repo_metricas_prioridade
  ON reposicao_metricas (empresa_id, prioridade, score DESC);
CREATE INDEX IF NOT EXISTS idx_repo_metricas_cobertura
  ON reposicao_metricas (empresa_id, cobertura_dias);

-- ── Índices que o cálculo precisa ────────────────────────────
-- Sem estes, cada rodada varre venda_itens inteiro.
CREATE INDEX IF NOT EXISTS idx_venda_itens_criado
  ON venda_itens (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_venda_itens_produto
  ON venda_itens (produto_id);
CREATE INDEX IF NOT EXISTS idx_vendas_empresa_criado
  ON vendas (empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pc_itens_produto
  ON pedidos_compra_itens (produto_id);

-- ── Conferência ──────────────────────────────────────────────
--   SELECT prioridade, count(*), round(avg(score))
--   FROM reposicao_metricas GROUP BY 1 ORDER BY 3 DESC;
