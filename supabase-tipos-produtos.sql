-- Novos campos em produtos: markup, promoção, tipo expandido
ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS markup          NUMERIC(10,4) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS preco_promocional NUMERIC(10,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS promocao_inicio TIMESTAMPTZ   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS promocao_fim    TIMESTAMPTZ   DEFAULT NULL,  -- NULL = sem prazo (infinito)
  ADD COLUMN IF NOT EXISTS promocao_ativa  BOOLEAN       DEFAULT false;

-- Tipos: simples | kit | generico | insumo | brinde
-- (coluna tipo já existe, apenas documentamos os valores válidos)

-- Tabela de itens de kit (kit é um produto composto de outros)
CREATE TABLE IF NOT EXISTS kit_itens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id       UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  produto_id   UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  quantidade   NUMERIC(10,4) NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(kit_id, produto_id)
);

ALTER TABLE kit_itens DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_kit_itens_kit_id ON kit_itens(kit_id);
