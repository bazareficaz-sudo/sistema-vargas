CREATE TABLE IF NOT EXISTS orcamentos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL,
  numero        SERIAL,
  cliente_id    UUID REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome  TEXT,
  operador_nome TEXT,
  status        TEXT NOT NULL DEFAULT 'aberto', -- aberto | aprovado | cancelado | convertido
  subtotal      NUMERIC(12,2) NOT NULL DEFAULT 0,
  desconto      NUMERIC(12,2) NOT NULL DEFAULT 0,
  total         NUMERIC(12,2) NOT NULL DEFAULT 0,
  observacao    TEXT,
  validade      DATE,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orcamento_itens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orcamento_id     UUID NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
  produto_id       UUID REFERENCES produtos(id) ON DELETE SET NULL,
  produto_nome     TEXT NOT NULL,
  produto_sku      TEXT,
  quantidade       NUMERIC(12,3) NOT NULL DEFAULT 1,
  preco_unitario   NUMERIC(12,2) NOT NULL,
  desconto         NUMERIC(5,2) NOT NULL DEFAULT 0,
  total            NUMERIC(12,2) NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE orcamentos DISABLE ROW LEVEL SECURITY;
ALTER TABLE orcamento_itens DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_orcamentos_empresa ON orcamentos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_orcamentos_created ON orcamentos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orcamento_itens_orc ON orcamento_itens(orcamento_id);
