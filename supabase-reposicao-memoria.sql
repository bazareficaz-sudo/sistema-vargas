-- ============================================================
-- MEMÓRIA DO AUXILIAR DE COMPRAS — fatia 6 (última do plano original)
--
-- Duas coisas que só existem depois que o sistema começa a prestar
-- atenção: quanto tempo cada produto passou zerado, e o que o comprador
-- faz com o que o motor sugere. Nenhuma das duas tem como nascer com
-- histórico — começam vazias hoje e vão se formando.
-- ============================================================

-- ── Histórico de ruptura ──────────────────────────────────────
-- Um período contínuo em que o estoque do produto ficou <= 0. `fim` nulo
-- quer dizer que a ruptura está aberta agora. Detectado pela rodada
-- noturna comparando o estoque de ontem com o de hoje — não por um gatilho
-- em cada lugar que mexe em `produtos.estoque` (venda, entrada, ajuste,
-- marketplace), que exigiria tocar em pontos demais do sistema pelo mesmo
-- ganho.
CREATE TABLE IF NOT EXISTS reposicao_rupturas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  produto_id UUID NOT NULL,
  inicio     DATE NOT NULL,
  fim        DATE,
  dias       INTEGER,

  -- Quantas faltas/encomendas chegaram do balcão enquanto a ruptura estava
  -- aberta — é a medida mais direta de demanda perdida (item 34 do desenho
  -- original) que existe: cliente pediu, não tinha.
  solicitacoes_durante         INTEGER NOT NULL DEFAULT 0,
  unidades_solicitadas_durante NUMERIC(12,3) NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE reposicao_rupturas DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_reposicao_rupturas_produto
  ON reposicao_rupturas (empresa_id, produto_id);
CREATE INDEX IF NOT EXISTS idx_reposicao_rupturas_abertas
  ON reposicao_rupturas (empresa_id, produto_id) WHERE fim IS NULL;

COMMENT ON TABLE reposicao_rupturas IS
  'Períodos em que o estoque do produto ficou <= 0. fim nulo = ruptura em andamento. Só existem rupturas a partir do dia em que esta tabela entrou no ar — não há como reconstruir o passado.';

-- ── Histórico das decisões do comprador ───────────────────────
-- O que o motor sugeriu contra o que virou pedido de verdade. Sem isto,
-- "o sistema recomenda 100, o comprador sempre altera para 60" é uma
-- impressão de quem trabalha na tela todo dia — com isto, vira número.
CREATE TABLE IF NOT EXISTS reposicao_decisoes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  produto_id UUID NOT NULL,

  evento     TEXT NOT NULL,   -- pedido_gerado | removido_sem_comprar
  quantidade_sugerida NUMERIC(14,4),
  quantidade_decidida NUMERIC(14,4),

  pedido_compra_id UUID,
  lista_item_id    UUID,
  usuario          TEXT,

  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE reposicao_decisoes DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_reposicao_decisoes_empresa
  ON reposicao_decisoes (empresa_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_reposicao_decisoes_produto
  ON reposicao_decisoes (empresa_id, produto_id);

COMMENT ON COLUMN reposicao_decisoes.evento IS
  'pedido_gerado = o item saiu da lista de compra e virou pedido, com a quantidade que ficou. removido_sem_comprar = o comprador tirou o item da lista sem nunca comprar.';

-- ── A quantidade que o comprador viu quando adicionou ─────────
-- Imutável: é o retrato do que o motor sugeriu no instante em que o item
-- entrou na lista de compra. `compras_lista_itens.quantidade` muda quando
-- o comprador ajusta; esta coluna não muda nunca, e é contra ela que
-- `quantidade_decidida` é comparada.
ALTER TABLE compras_lista_itens
  ADD COLUMN IF NOT EXISTS quantidade_sugerida_original NUMERIC(14,4);

-- ── ABC por margem, ao lado do ABC por faturamento ────────────
-- `classe_abc` (fatia 2) já existe e é por faturamento. Produto de giro
-- alto e margem baixa (ex.: cimento) pode ser classe A em faturamento e
-- pouco relevante em lucro — e o contrário também acontece.
ALTER TABLE reposicao_metricas
  ADD COLUMN IF NOT EXISTS classe_abc_margem TEXT;

-- ── Conferência ──────────────────────────────────────────────
--   SELECT count(*) FROM reposicao_rupturas WHERE fim IS NULL;
--   SELECT evento, count(*) FROM reposicao_decisoes GROUP BY 1;
