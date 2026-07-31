-- ============================================================
-- Motor de Precificação — Fase 3: histórico de alteração de preço
--
-- Uma linha por preço alterado pelo recálculo em massa. Guarda o valor
-- antigo, o novo, a regra que mandou, quem mandou e se chegou ao
-- marketplace — para que "por que este preço mudou?" tenha resposta meses
-- depois, e para conferir o que de fato subiu quando algo dá errado.
--
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS precificacao_historico (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL,
  anuncio_id     UUID REFERENCES marketplace_anuncios(id) ON DELETE SET NULL,
  canal_id       UUID REFERENCES marketplace_canais(id) ON DELETE SET NULL,
  produto_id     UUID REFERENCES produtos(id) ON DELETE SET NULL,

  preco_anterior NUMERIC(12,2),
  preco_novo     NUMERIC(12,2) NOT NULL,
  custo_no_momento NUMERIC(12,2),
  margem_anterior  NUMERIC(8,2),
  margem_nova      NUMERIC(8,2),

  -- Rastro da decisão: qual regra mandou e com que objetivo. O nome fica
  -- copiado de propósito — se a regra for renomeada ou apagada depois, o
  -- histórico continua explicando o que aconteceu naquele dia.
  regra_id       UUID REFERENCES precificacao_regra(id) ON DELETE SET NULL,
  regra_nome     TEXT,
  regra_objetivo TEXT,

  origem         TEXT NOT NULL DEFAULT 'recalculo_massa',
  enviado_marketplace BOOLEAN NOT NULL DEFAULT false,
  erro_envio     TEXT,

  usuario_id     UUID REFERENCES auth.users(id),
  usuario_nome   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE precificacao_historico DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_prec_hist_empresa ON precificacao_historico(empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prec_hist_anuncio ON precificacao_historico(anuncio_id, created_at DESC);
