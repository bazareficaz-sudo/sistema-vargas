-- ============================================================
-- MÓDULO INVENTÁRIO DE ESTOQUE
-- ============================================================

-- Depósitos por empresa
CREATE TABLE IF NOT EXISTS depositos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL,
  nome        TEXT NOT NULL,
  descricao   TEXT,
  ativo       BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);
INSERT INTO depositos (empresa_id, nome)
  SELECT DISTINCT empresa_id, 'Principal'
  FROM produtos
  ON CONFLICT DO NOTHING;
ALTER TABLE depositos DISABLE ROW LEVEL SECURITY;

-- Inventários
CREATE TABLE IF NOT EXISTS inventarios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL,
  deposito_id     UUID REFERENCES depositos(id),
  deposito_nome   TEXT,
  numero          SERIAL,
  descricao       TEXT NOT NULL,
  tipo            TEXT NOT NULL DEFAULT 'geral',
  -- geral | parcial | categoria | subcategoria | marca | entrada | manual
  status          TEXT NOT NULL DEFAULT 'aberto',
  -- aberto | em_contagem | finalizado | cancelado
  responsavel     TEXT,
  observacao      TEXT,
  data_abertura   DATE NOT NULL DEFAULT CURRENT_DATE,
  data_finalizacao TIMESTAMPTZ,
  criado_por      TEXT,
  finalizado_por  TEXT,
  cancelado_por   TEXT,
  motivo_cancelamento TEXT,
  entrada_id      UUID,  -- referência opcional a entradas
  total_itens     INT DEFAULT 0,
  itens_contados  INT DEFAULT 0,
  itens_divergentes INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE inventarios DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_inventarios_empresa ON inventarios(empresa_id);
CREATE INDEX IF NOT EXISTS idx_inventarios_status ON inventarios(status);

-- Itens do inventário
CREATE TABLE IF NOT EXISTS inventario_itens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_id   UUID NOT NULL REFERENCES inventarios(id) ON DELETE CASCADE,
  produto_id      UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  produto_nome    TEXT NOT NULL,
  produto_sku     TEXT,
  produto_ean     TEXT,
  categoria       TEXT,
  marca           TEXT,
  unidade         TEXT DEFAULT 'UN',
  origem          TEXT DEFAULT 'manual',
  -- manual | categoria | subcategoria | marca | entrada
  estoque_sistema NUMERIC(12,3) DEFAULT 0,  -- snapshot no momento da abertura
  qtd_contada     NUMERIC(12,3),            -- null = não contado
  diferenca       NUMERIC(12,3) GENERATED ALWAYS AS (qtd_contada - estoque_sistema) STORED,
  preco_custo     NUMERIC(12,2) DEFAULT 0,
  status_item     TEXT DEFAULT 'pendente',
  -- pendente | contado | divergente | ajustado
  contado_por     TEXT,
  contado_em      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(inventario_id, produto_id)
);
ALTER TABLE inventario_itens DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_inv_itens_inventario ON inventario_itens(inventario_id);
CREATE INDEX IF NOT EXISTS idx_inv_itens_produto ON inventario_itens(produto_id);

-- Histórico / auditoria
CREATE TABLE IF NOT EXISTS inventario_historico (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_id   UUID NOT NULL REFERENCES inventarios(id) ON DELETE CASCADE,
  acao            TEXT NOT NULL,
  descricao       TEXT,
  usuario         TEXT,
  dados           JSONB,
  created_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE inventario_historico DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_inv_hist_inventario ON inventario_historico(inventario_id);

-- Movimentações de estoque geradas pelo inventário
CREATE TABLE IF NOT EXISTS estoque_movimentacoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL,
  deposito_id     UUID,
  produto_id      UUID NOT NULL REFERENCES produtos(id),
  produto_nome    TEXT,
  tipo            TEXT NOT NULL,
  -- ajuste_entrada | ajuste_saida | venda | compra | transferencia
  quantidade      NUMERIC(12,3) NOT NULL,
  estoque_anterior NUMERIC(12,3),
  estoque_novo    NUMERIC(12,3),
  motivo          TEXT,
  referencia_id   UUID,   -- inventario_id, venda_id, etc
  referencia_tipo TEXT,   -- inventario, venda, etc
  usuario         TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE estoque_movimentacoes DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mov_empresa ON estoque_movimentacoes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_mov_produto ON estoque_movimentacoes(produto_id);
