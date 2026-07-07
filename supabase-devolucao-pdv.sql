-- ============================================================
-- DEVOLUÇÃO NO PDV
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. TABELA vendas (se não existir)
CREATE TABLE IF NOT EXISTS vendas (
  id              TEXT PRIMARY KEY,
  empresa_id      UUID,
  cliente_id      TEXT,
  operador_nome   TEXT,
  status          TEXT DEFAULT 'concluida',
  subtotal        NUMERIC(10,2) DEFAULT 0,
  desconto        NUMERIC(10,2) DEFAULT 0,
  total           NUMERIC(10,2) DEFAULT 0,
  forma_pagamento TEXT,
  valor_pago      NUMERIC(10,2) DEFAULT 0,
  troco           NUMERIC(10,2) DEFAULT 0,
  observacao      TEXT,
  entrega_solicitada BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE vendas DISABLE ROW LEVEL SECURITY;

-- 2. TABELA venda_itens (se não existir)
CREATE TABLE IF NOT EXISTS venda_itens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venda_id        TEXT NOT NULL,
  produto_id      TEXT,
  produto_nome    TEXT,
  produto_sku     TEXT,
  quantidade      NUMERIC(10,3) DEFAULT 1,
  preco_unitario  NUMERIC(10,2) DEFAULT 0,
  desconto        NUMERIC(5,2)  DEFAULT 0,
  total           NUMERIC(10,2) DEFAULT 0,
  tipo            TEXT DEFAULT 'venda',
  created_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE venda_itens DISABLE ROW LEVEL SECURITY;

-- 3. CAMPOS ADICIONAIS em vendas (devolução)
ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS tipo_operacao    TEXT DEFAULT 'venda',
  ADD COLUMN IF NOT EXISTS tem_devolucao    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS total_devolucoes NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credito_gerado   NUMERIC(10,2) DEFAULT 0;

-- 4. CAMPO tipo em venda_itens (já incluído no CREATE, mas garante se a tabela existia antes)
ALTER TABLE venda_itens
  ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'venda';

-- 5. ÍNDICES
CREATE INDEX IF NOT EXISTS idx_vendas_empresa        ON vendas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_vendas_tipo_operacao  ON vendas(tipo_operacao);
CREATE INDEX IF NOT EXISTS idx_venda_itens_venda     ON venda_itens(venda_id);
CREATE INDEX IF NOT EXISTS idx_venda_itens_tipo      ON venda_itens(tipo);
