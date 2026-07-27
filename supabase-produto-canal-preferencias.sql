-- ═══════════════════════════════════════════════════════════════════════
--  MAPA DE ANÚNCIOS POR PRODUTO — preferências de canal
--  Criação: 2026-07-27
--  Guarda "não anunciar este produto neste canal" + observação, usado
--  pela tela /dashboard/mapa-anuncios pra não repetir a mesma oportunidade
--  toda vez e deixar registrado o porquê.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS produto_canal_preferencias (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  produto_id     UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  canal_id       UUID NOT NULL REFERENCES marketplace_canais(id) ON DELETE CASCADE,
  nao_anunciar   BOOLEAN NOT NULL DEFAULT false,
  observacao     TEXT,
  atualizado_por UUID REFERENCES auth.users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(produto_id, canal_id)
);

ALTER TABLE produto_canal_preferencias DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_produto_canal_pref_produto ON produto_canal_preferencias(produto_id);
CREATE INDEX IF NOT EXISTS idx_produto_canal_pref_empresa ON produto_canal_preferencias(empresa_id);
