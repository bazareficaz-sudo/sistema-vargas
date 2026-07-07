-- Fornecedores
CREATE TABLE IF NOT EXISTS fornecedores (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID REFERENCES empresas(id),
  razao_social   TEXT NOT NULL,
  nome_fantasia  TEXT,
  cnpj           TEXT,
  ie             TEXT,
  telefone       TEXT,
  email          TEXT,
  contato        TEXT,
  endereco       TEXT,
  numero         TEXT,
  complemento    TEXT,
  bairro         TEXT,
  cidade         TEXT,
  estado         TEXT,
  cep            TEXT,
  observacoes    TEXT,
  ativo          BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Entradas de mercadoria (cabeçalho da nota)
CREATE TABLE IF NOT EXISTS entradas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID REFERENCES empresas(id),
  fornecedor_id  UUID REFERENCES fornecedores(id),
  numero_nf      TEXT,
  serie          TEXT,
  data_emissao   DATE,
  data_entrada   TIMESTAMPTZ DEFAULT now(),
  valor_produtos NUMERIC(12,2) DEFAULT 0,
  valor_frete    NUMERIC(12,2) DEFAULT 0,
  valor_desconto NUMERIC(12,2) DEFAULT 0,
  valor_outros   NUMERIC(12,2) DEFAULT 0,
  valor_total    NUMERIC(12,2) DEFAULT 0,
  observacoes    TEXT,
  status         TEXT DEFAULT 'rascunho',  -- rascunho | confirmada | cancelada
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Itens da entrada
CREATE TABLE IF NOT EXISTS entrada_itens (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entrada_id            UUID NOT NULL REFERENCES entradas(id) ON DELETE CASCADE,
  produto_id            UUID REFERENCES produtos(id),
  nome_produto          TEXT NOT NULL,
  sku                   TEXT,
  quantidade            NUMERIC(10,4) NOT NULL DEFAULT 1,
  preco_custo_anterior  NUMERIC(10,2) DEFAULT 0,
  preco_custo_novo      NUMERIC(10,2) NOT NULL DEFAULT 0,
  markup                NUMERIC(10,4) DEFAULT 0,
  preco_venda_novo      NUMERIC(10,2) DEFAULT 0,
  atualizar_custo       BOOLEAN DEFAULT true,
  atualizar_preco       BOOLEAN DEFAULT true,
  subtotal              NUMERIC(12,2) DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- Contas a pagar
CREATE TABLE IF NOT EXISTS contas_pagar (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       UUID REFERENCES empresas(id),
  entrada_id       UUID REFERENCES entradas(id),
  fornecedor_id    UUID REFERENCES fornecedores(id),
  descricao        TEXT NOT NULL,
  valor            NUMERIC(12,2) NOT NULL,
  vencimento       DATE NOT NULL,
  parcela          INT DEFAULT 1,
  total_parcelas   INT DEFAULT 1,
  status           TEXT DEFAULT 'pendente',  -- pendente | pago | vencido | cancelado
  data_pagamento   DATE,
  forma_pagamento  TEXT,
  observacoes      TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE fornecedores DISABLE ROW LEVEL SECURITY;
ALTER TABLE entradas     DISABLE ROW LEVEL SECURITY;
ALTER TABLE entrada_itens DISABLE ROW LEVEL SECURITY;
ALTER TABLE contas_pagar DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_entradas_empresa      ON entradas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_entradas_fornecedor   ON entradas(fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_entrada_itens_entrada ON entrada_itens(entrada_id);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_empresa  ON contas_pagar(empresa_id);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_status   ON contas_pagar(status);
