-- ============================================================
-- TABELAS EXTRAS PARA MIGRAÇÃO DO PDV VARGAS
-- ============================================================

-- Vendedores
CREATE TABLE IF NOT EXISTS vendedores (
  id          TEXT PRIMARY KEY,
  empresa_id  UUID NOT NULL,
  codigo      TEXT,
  nome        TEXT NOT NULL,
  comissao    NUMERIC(5,2) DEFAULT 0,
  ativo       BOOLEAN DEFAULT true
);
ALTER TABLE vendedores DISABLE ROW LEVEL SECURITY;

-- Contas a receber (carteira/crédito do cliente nas vendas)
CREATE TABLE IF NOT EXISTS contas_receber (
  id                 TEXT PRIMARY KEY,
  empresa_id         UUID NOT NULL,
  cliente_id         TEXT,
  cliente_nome       TEXT,
  valor              NUMERIC(10,2) DEFAULT 0,
  descricao          TEXT,
  origem             TEXT,
  status             TEXT DEFAULT 'pendente',
  vencimento         DATE,
  data_pagamento     DATE,
  forma_recebimento  TEXT,
  referencia         TEXT,
  observacao         TEXT,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE contas_receber DISABLE ROW LEVEL SECURITY;

-- Créditos de clientes (saldo de crédito gerado por troco/devoluções)
CREATE TABLE IF NOT EXISTS creditos_cliente (
  id                   TEXT PRIMARY KEY,
  empresa_id           UUID NOT NULL,
  cliente_id           TEXT,
  cliente_nome         TEXT,
  cliente_telefone     TEXT,
  venda_origem_id      TEXT,
  venda_origem_numero  INTEGER,
  valor_original       NUMERIC(10,2) DEFAULT 0,
  saldo_atual          NUMERIC(10,2) DEFAULT 0,
  status               TEXT DEFAULT 'ativo',
  origem               TEXT,
  observacao           TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE creditos_cliente DISABLE ROW LEVEL SECURITY;

-- Lista de faltas (produtos solicitados que não tinham em estoque)
CREATE TABLE IF NOT EXISTS faltas (
  id                    TEXT PRIMARY KEY,
  empresa_id            UUID NOT NULL,
  produto_id            TEXT,
  produto_nome          TEXT NOT NULL,
  produto_sku           TEXT,
  cliente_nome          TEXT,
  cliente_telefone      TEXT,
  quantidade_solicitada NUMERIC(10,3) DEFAULT 1,
  observacao            TEXT,
  status                TEXT DEFAULT 'pendente',
  origem                TEXT,
  usuario_nome          TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE faltas DISABLE ROW LEVEL SECURITY;

-- Garante colunas extras que podem não existir ainda em produtos e vendas
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cfop TEXT;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS icms_cst TEXT;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS icms_origem INTEGER;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pis_cst TEXT;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cofins_cst TEXT;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS emoji TEXT;

ALTER TABLE vendas ADD COLUMN IF NOT EXISTS numero INTEGER;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS operador_nome TEXT;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS vendedor_id TEXT;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS vendedor_nome TEXT;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS vendedor_codigo TEXT;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS valor_pago NUMERIC(10,2);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS troco NUMERIC(10,2);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS nfce_emitida BOOLEAN DEFAULT false;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS nfce_chave TEXT;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS nfce_numero TEXT;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS nfce_serie TEXT;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS nfce_url_pdf TEXT;

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS referencia TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS obs_entrega TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS saldo_devedor NUMERIC(10,2) DEFAULT 0;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS status_credito TEXT DEFAULT 'ativo';
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS permite_carteira BOOLEAN DEFAULT false;
