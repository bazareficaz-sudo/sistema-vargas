-- ============================================================
-- SHOPEE PRODUCT SYNC — Fase 1 (fundação) + Fase 2 (importação)
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. marketplace_canais: reconectar a mesma loja não deve duplicar canal
CREATE UNIQUE INDEX IF NOT EXISTS uq_canais_empresa_plataforma_seller
  ON marketplace_canais (empresa_id, plataforma, seller_id)
  WHERE seller_id IS NOT NULL;

-- 2. marketplace_anuncios: campos Shopee-específicos (nullable, não afeta
--    outras plataformas) + constraint de idempotência para upsert
ALTER TABLE marketplace_anuncios
  ADD COLUMN IF NOT EXISTS estoque_externo   INTEGER,
  ADD COLUMN IF NOT EXISTS categoria_externa TEXT,
  ADD COLUMN IF NOT EXISTS marca_externa     TEXT,
  ADD COLUMN IF NOT EXISTS imagens           JSONB,
  ADD COLUMN IF NOT EXISTS tem_variacao      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dados_brutos      JSONB,
  ADD COLUMN IF NOT EXISTS ultima_atualizacao_externa TIMESTAMPTZ;

-- Idempotência do upsert (mesmo padrão já usado em marketplace_pedidos).
-- Índice parcial: não afeta rascunhos manuais criados sem id_externo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_anuncios_canal_idexterno
  ON marketplace_anuncios (canal_id, id_externo)
  WHERE id_externo IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_anuncios_dados_brutos_gin
  ON marketplace_anuncios USING GIN (dados_brutos);

-- 3. marketplace_anuncio_variacoes: conceito novo — "model" da Shopee
--    (variante de SKU, ex: cor/tamanho). Um anúncio pode ter várias.
CREATE TABLE IF NOT EXISTS marketplace_anuncio_variacoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL,
  anuncio_id      UUID NOT NULL REFERENCES marketplace_anuncios(id) ON DELETE CASCADE,
  model_id        TEXT NOT NULL,       -- string p/ evitar perda de precisão de int64
  nome_variacao   TEXT,
  sku_variacao    TEXT,
  preco           NUMERIC(10,2),
  estoque         INTEGER,
  status_externo  TEXT,
  dados_brutos    JSONB,
  sincronizado_em TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (anuncio_id, model_id)
);
ALTER TABLE marketplace_anuncio_variacoes DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_variacoes_anuncio ON marketplace_anuncio_variacoes(anuncio_id);
CREATE INDEX IF NOT EXISTS idx_variacoes_empresa ON marketplace_anuncio_variacoes(empresa_id);

-- 4. marketplace_sync_log: sem alteração de schema — reutiliza tipo/status/
--    mensagem/detalhes já existentes. Convenção de valores para `tipo`
--    introduzidos por esta fase: 'conexao' (testar conexão), 'produto_sync'
--    (sincronização de catálogo/anúncios).
