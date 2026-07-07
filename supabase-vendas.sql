-- Tabelas para PDV Web / Vendas

CREATE TABLE IF NOT EXISTS vendas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  operador_nome TEXT,
  status TEXT NOT NULL DEFAULT 'concluida', -- concluida, cancelada, pendente
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  desconto NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  forma_pagamento TEXT, -- dinheiro, debito, credito, pix, carteira, multiplo
  valor_pago NUMERIC(12,2) DEFAULT 0,
  troco NUMERIC(12,2) DEFAULT 0,
  observacao TEXT,
  entrega_solicitada BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venda_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venda_id UUID NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
  produto_id UUID REFERENCES produtos(id) ON DELETE SET NULL,
  produto_nome TEXT NOT NULL,
  produto_sku TEXT,
  quantidade NUMERIC(12,3) NOT NULL DEFAULT 1,
  preco_unitario NUMERIC(12,2) NOT NULL,
  desconto NUMERIC(5,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE vendas DISABLE ROW LEVEL SECURITY;
ALTER TABLE venda_itens DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_vendas_empresa ON vendas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_vendas_created ON vendas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_venda_itens_venda ON venda_itens(venda_id);
