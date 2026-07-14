-- ============================================================
-- SHOPEE — Fase 5 (Criação e enriquecimento de produtos)
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- Histórico de alterações aplicadas a um produto a partir de dados de um
-- anúncio (enriquecimento) — auditoria campo a campo. Distinta de
-- marketplace_mapeamentos (que é cache de vínculo por chave, não log).
CREATE TABLE IF NOT EXISTS marketplace_enriquecimento_historico (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL,
  produto_id     UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  anuncio_id     UUID REFERENCES marketplace_anuncios(id) ON DELETE SET NULL,
  campo          TEXT NOT NULL,   -- 'nome' | 'marca' | 'preco_venda' | 'estoque' | 'imagem'
  valor_anterior TEXT,
  valor_novo     TEXT,
  operador       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE marketplace_enriquecimento_historico DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_enriq_hist_produto ON marketplace_enriquecimento_historico(produto_id);
CREATE INDEX IF NOT EXISTS idx_enriq_hist_anuncio ON marketplace_enriquecimento_historico(anuncio_id);

-- marketplace_mapeamentos.metodo ganha um novo valor possível ('criado',
-- quando o produto foi criado a partir do anúncio em vez de vinculado a um
-- já existente) — coluna já é TEXT livre (supabase-marketplace-mapeamento.sql),
-- nenhuma alteração de schema necessária.
