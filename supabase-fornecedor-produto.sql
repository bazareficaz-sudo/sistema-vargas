-- ============================================================
-- FORNECEDOR × PRODUTO — Auxiliar de Compras (fatia 3)
--
-- Hoje `produtos` não tem `fornecedor_id`. Só existe `codigo_fornecedor`
-- (texto), preenchido em 127 dos 14.471 produtos. Não há prazo de entrega,
-- pedido mínimo nem múltiplo de embalagem em lugar nenhum — nada disso é
-- alteração de tabela existente, é estrutura nova.
--
-- O histórico de compra (último custo, custo médio, última compra) já
-- existe e está correto em /api/pedidos-compra/historico-fornecedor,
-- lendo entrada manual + XML. Esta tabela reaproveita esse cálculo, só que
-- materializado por produto×fornecedor em vez de recalculado a cada tela.
-- ============================================================

-- ── Dados que faltavam no cadastro do fornecedor ─────────────
ALTER TABLE fornecedores
  ADD COLUMN IF NOT EXISTS prazo_entrega_dias      INTEGER,
  ADD COLUMN IF NOT EXISTS pedido_minimo_valor      NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS condicao_pagamento_padrao TEXT;

COMMENT ON COLUMN fornecedores.prazo_entrega_dias IS
  'Prazo cadastrado à mão. Some diante do prazo real (fornecedor_produto.prazo_entrega_real_dias) assim que houver amostra suficiente.';

-- ── Fornecedor preferido do produto ───────────────────────────
-- Resolve os 127 `codigo_fornecedor` soltos: aponta para o fornecedor da
-- tabela própria, em vez de um texto sem vínculo.
ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS fornecedor_padrao_id UUID;

CREATE INDEX IF NOT EXISTS idx_produtos_fornecedor_padrao
  ON produtos (fornecedor_padrao_id) WHERE fornecedor_padrao_id IS NOT NULL;

-- ── O vínculo em si ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fornecedor_produto (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID NOT NULL,
  fornecedor_id UUID NOT NULL,
  produto_id   UUID NOT NULL,

  -- Calculado — recalculado toda noite a partir de entradas + XML. Não
  -- editar à mão: a próxima rodada sobrescreve.
  custo_ultimo      NUMERIC(14,4),
  custo_medio       NUMERIC(14,4),
  custo_menor_recente NUMERIC(14,4),
  custo_maior_recente NUMERIC(14,4),
  quantidade_ultima NUMERIC(14,4),
  ultima_compra_em  TIMESTAMPTZ,
  compras_contadas  INTEGER NOT NULL DEFAULT 0,

  -- Prazo real: diferença entre pedido e entrada, só existe depois que
  -- entradas passarem a referenciar `pedidos_compra` (ver
  -- entradas.pedido_compra_id abaixo). Começa vazio — não tem como
  -- inventar amostra que ainda não aconteceu.
  prazo_entrega_real_dias  NUMERIC(6,1),
  prazo_entrega_amostras   INTEGER NOT NULL DEFAULT 0,

  -- Editado à mão, pelo comprador. A rodada noturna nunca toca aqui.
  prazo_entrega_dias   INTEGER,
  quantidade_minima    NUMERIC(14,4),
  multiplo_embalagem   NUMERIC(14,4),
  preferencial         BOOLEAN NOT NULL DEFAULT false,
  observacao           TEXT,

  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, fornecedor_id, produto_id)
);
ALTER TABLE fornecedor_produto DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_forn_prod_produto
  ON fornecedor_produto (empresa_id, produto_id);
CREATE INDEX IF NOT EXISTS idx_forn_prod_fornecedor
  ON fornecedor_produto (empresa_id, fornecedor_id);

COMMENT ON TABLE fornecedor_produto IS
  'Fornecedores históricos de cada produto. Uma linha por par fornecedor×produto; os campos "calculado" vêm da rodada noturna, os "editado à mão" nunca são sobrescritos por ela.';

-- ── Vínculo pedido ↔ entrada ──────────────────────────────────
-- Sem isto não há como saber que uma entrada é a chegada de um pedido
-- específico — nem lead time real (7), nem marcar pedido como recebido
-- automaticamente, nem "já tem pedido em aberto para este fornecedor,
-- ligue os dois" (18).
ALTER TABLE entradas
  ADD COLUMN IF NOT EXISTS pedido_compra_id UUID;
ALTER TABLE nfe_entradas
  ADD COLUMN IF NOT EXISTS pedido_compra_id UUID;

CREATE INDEX IF NOT EXISTS idx_entradas_pedido_compra
  ON entradas (pedido_compra_id) WHERE pedido_compra_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nfe_entradas_pedido_compra
  ON nfe_entradas (pedido_compra_id) WHERE pedido_compra_id IS NOT NULL;

-- De onde veio o pedido — separa o que o comprador criou do que o
-- Auxiliar sugeriu, sem misturar com as Regras de Reposição das
-- automações, que já criam rascunho sozinhas.
ALTER TABLE pedidos_compra
  ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'manual';
COMMENT ON COLUMN pedidos_compra.origem IS
  'manual | auxiliar | automacao';

-- ── Conferência ──────────────────────────────────────────────
--   SELECT count(*) FROM fornecedor_produto;
--   SELECT count(*) FROM fornecedor_produto WHERE prazo_entrega_dias IS NOT NULL;
