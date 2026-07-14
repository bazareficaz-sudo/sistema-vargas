-- ============================================================
-- SHOPEE — Fase 4 (Mapeamento)
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- Cada variação da Shopee ("model") pode ser vinculada ao seu próprio
-- produto do sistema, já que não existe conceito de variação de SKU aqui
-- (só kit_itens, que é composição de produtos distintos, não variante).
ALTER TABLE marketplace_anuncio_variacoes
  ADD COLUMN IF NOT EXISTS produto_id UUID REFERENCES produtos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_variacoes_produto ON marketplace_anuncio_variacoes(produto_id);

-- Histórico + cache de aprendizado de mapeamento (mesmo espírito de
-- nfe_mapeamentos: uma linha vigente por chave, não um log multi-linha).
-- Usado por sync.ts para auto-preencher produto_id em anúncios/variações
-- novos e ainda não mapeados, sem nunca sobrescrever um vínculo existente.
CREATE TABLE IF NOT EXISTS marketplace_mapeamentos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            UUID NOT NULL,
  canal_id              UUID NOT NULL REFERENCES marketplace_canais(id) ON DELETE CASCADE,
  nivel                 TEXT NOT NULL DEFAULT 'anuncio',  -- 'anuncio' | 'variacao'
  chave                 TEXT NOT NULL,                     -- sku_canal ou sku_variacao
  anuncio_id            UUID REFERENCES marketplace_anuncios(id) ON DELETE SET NULL,
  variacao_id           UUID REFERENCES marketplace_anuncio_variacoes(id) ON DELETE SET NULL,
  produto_id            UUID REFERENCES produtos(id) ON DELETE SET NULL,
  produto_nome_snapshot TEXT,
  produto_sku_snapshot  TEXT,
  metodo                TEXT NOT NULL DEFAULT 'manual',   -- manual | automatico_sku
  operador              TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, canal_id, nivel, chave)
);
ALTER TABLE marketplace_mapeamentos DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mapeamentos_canal_chave ON marketplace_mapeamentos(canal_id, chave);
