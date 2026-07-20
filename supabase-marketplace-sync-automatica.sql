-- ============================================================
-- Sincronização automática de estoque por canal + regra associada por anúncio
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- `sincronizar_estoque` já existia (era um interruptor morto — nunca lido
-- por nenhum código). Passa a ser o toggle MESTRE: se false, nenhum dos
-- 3 abaixo faz efeito, independente do próprio valor.
ALTER TABLE marketplace_canais
  ADD COLUMN IF NOT EXISTS debitar_estoque_vendas   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS atualizar_estoque_canal  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS aplicar_regra_produto    BOOLEAN NOT NULL DEFAULT false;

-- Regra fixa por anúncio — usada pela sincronização automática quando
-- aplicar_regra_produto está ativo. Sem isso, a sincronização automática só
-- espelha o estoque do produto vinculado 1:1, sem cálculo de preço.
ALTER TABLE marketplace_anuncios
  ADD COLUMN IF NOT EXISTS regra_id UUID REFERENCES marketplace_regras_preco(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_anuncios_regra ON marketplace_anuncios(regra_id);
