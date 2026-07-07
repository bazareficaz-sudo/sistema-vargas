-- ============================================================
-- MÓDULO DEPÓSITOS — estoque por empresa/depósito/produto
-- ============================================================

-- Enhance tabela depositos (já existe do inventários, adiciona campos)
ALTER TABLE depositos
  ADD COLUMN IF NOT EXISTS codigo          TEXT,
  ADD COLUMN IF NOT EXISTS tipo            TEXT DEFAULT 'loja',
  ADD COLUMN IF NOT EXISTS principal       BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS responsavel     TEXT,
  ADD COLUMN IF NOT EXISTS telefone        TEXT,
  ADD COLUMN IF NOT EXISTS email           TEXT,
  ADD COLUMN IF NOT EXISTS logradouro      TEXT,
  ADD COLUMN IF NOT EXISTS numero          TEXT,
  ADD COLUMN IF NOT EXISTS bairro          TEXT,
  ADD COLUMN IF NOT EXISTS cidade          TEXT,
  ADD COLUMN IF NOT EXISTS uf              TEXT,
  ADD COLUMN IF NOT EXISTS cep             TEXT,
  ADD COLUMN IF NOT EXISTS observacao      TEXT,
  ADD COLUMN IF NOT EXISTS criado_por      TEXT,
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ DEFAULT now();

-- Marca o primeiro depósito de cada empresa como principal
UPDATE depositos d
SET principal = true
WHERE d.id = (
  SELECT id FROM depositos d2
  WHERE d2.empresa_id = d.empresa_id
  ORDER BY created_at LIMIT 1
) AND NOT EXISTS (
  SELECT 1 FROM depositos d3 WHERE d3.empresa_id = d.empresa_id AND d3.principal = true
);

-- Estoque por produto/empresa/depósito
CREATE TABLE IF NOT EXISTS produto_estoque (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL,
  deposito_id       UUID NOT NULL REFERENCES depositos(id) ON DELETE CASCADE,
  produto_id        UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  quantidade        NUMERIC(12,3) NOT NULL DEFAULT 0,
  estoque_minimo    NUMERIC(12,3) DEFAULT 0,
  estoque_maximo    NUMERIC(12,3) DEFAULT 0,
  localizacao       TEXT,
  ultima_movimentacao TIMESTAMPTZ DEFAULT now(),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(empresa_id, deposito_id, produto_id)
);
ALTER TABLE produto_estoque DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_prod_est_empresa   ON produto_estoque(empresa_id);
CREATE INDEX IF NOT EXISTS idx_prod_est_deposito  ON produto_estoque(deposito_id);
CREATE INDEX IF NOT EXISTS idx_prod_est_produto   ON produto_estoque(produto_id);

-- Populace produto_estoque a partir do estoque atual dos produtos
-- (cria um registro no depósito principal de cada empresa)
INSERT INTO produto_estoque (empresa_id, deposito_id, produto_id, quantidade)
SELECT p.empresa_id, d.id, p.id, COALESCE(p.estoque, 0)
FROM produtos p
JOIN depositos d ON d.empresa_id = p.empresa_id AND d.principal = true
WHERE p.ativo = true
ON CONFLICT (empresa_id, deposito_id, produto_id) DO NOTHING;

-- Ensure estoque_movimentacoes tem todos os campos necessários
ALTER TABLE estoque_movimentacoes
  ADD COLUMN IF NOT EXISTS deposito_origem_id  UUID,
  ADD COLUMN IF NOT EXISTS deposito_destino_id UUID,
  ADD COLUMN IF NOT EXISTS observacao          TEXT;

-- Transferências entre depósitos
CREATE TABLE IF NOT EXISTS transferencias_estoque (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL,
  deposito_origem   UUID NOT NULL REFERENCES depositos(id),
  deposito_destino  UUID NOT NULL REFERENCES depositos(id),
  produto_id        UUID NOT NULL REFERENCES produtos(id),
  produto_nome      TEXT,
  quantidade        NUMERIC(12,3) NOT NULL,
  observacao        TEXT,
  usuario           TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE transferencias_estoque DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_transf_empresa ON transferencias_estoque(empresa_id);
