-- ============================================================
-- Fase 8 Shopee: regras de preço/estoque salvas e reutilizáveis
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS marketplace_regras_preco (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL,
  canal_id       UUID NOT NULL REFERENCES marketplace_canais(id) ON DELETE CASCADE,
  nome           TEXT NOT NULL,
  -- preço
  modo_preco     TEXT NOT NULL DEFAULT 'nao',    -- nao | fixo | percentual | formula | produto
  valor_preco    NUMERIC(10,4),                  -- valor fixo (R$), ajuste (%) ou markup (%) conforme modo_preco
  arredondamento TEXT NOT NULL DEFAULT 'nenhum', -- nenhum | terminar_90 | terminar_99 | cima_inteiro
  -- estoque
  modo_estoque   TEXT NOT NULL DEFAULT 'nao',    -- nao | fixo | produto | deposito
  valor_estoque  NUMERIC(12,2),
  deposito_id    UUID REFERENCES depositos(id) ON DELETE SET NULL,
  ativo          BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE marketplace_regras_preco DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_regras_preco_canal   ON marketplace_regras_preco(canal_id);
CREATE INDEX IF NOT EXISTS idx_regras_preco_empresa ON marketplace_regras_preco(empresa_id);
