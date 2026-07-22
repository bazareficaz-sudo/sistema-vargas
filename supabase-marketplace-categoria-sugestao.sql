-- ============================================================
-- Lembra qual categoria da Shopee foi usada da última vez pra produtos
-- com a mesma categoria interna da loja — pré-seleciona automaticamente
-- na próxima criação de anúncio, sem precisar de IA.
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS marketplace_categoria_sugestao (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL,
  canal_id          UUID NOT NULL REFERENCES marketplace_canais(id) ON DELETE CASCADE,
  produto_categoria TEXT NOT NULL,
  categoria_ids     INTEGER[] NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, canal_id, produto_categoria)
);
ALTER TABLE marketplace_categoria_sugestao DISABLE ROW LEVEL SECURITY;
