-- ============================================================
-- Motor de Precificação — Fase 2: hierarquia de regras
--
-- Uma regra diz QUANTO você quer ganhar; a configuração de taxas (Fase 1)
-- diz QUANTO o canal cobra. As duas juntas produzem o preço.
--
-- A regra mais específica vence: produto > categoria > marca > canal >
-- plataforma > empresa. Uma regra amarrada a um canal específico ganha do
-- equivalente sem canal.
--
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS precificacao_regra (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL,
  nome            TEXT NOT NULL,

  -- produto | categoria | marca | canal | plataforma | empresa
  nivel           TEXT NOT NULL,
  -- Alvo do nível: id para produto/canal, texto para categoria/marca/
  -- plataforma. Nível 'empresa' não tem alvo (vale pra tudo).
  alvo_id         UUID,
  alvo_texto      TEXT,

  -- Opcional em qualquer nível: restringe a regra a um canal. Serve pra
  -- "categoria Ferramentas, mas só na Shopee Eficaz".
  canal_id        UUID REFERENCES marketplace_canais(id) ON DELETE CASCADE,

  -- margem_liquida | sobre_custo | markup | lucro_fixo
  objetivo_tipo   TEXT NOT NULL,
  objetivo_valor  NUMERIC(12,4) NOT NULL,

  -- Piso de segurança: se o objetivo resultar em margem menor que esta, o
  -- preço sobe até respeitá-la (e o sistema avisa que interveio).
  margem_minima   NUMERIC(6,2),

  arredondamento  TEXT NOT NULL DEFAULT 'nenhum',  -- nenhum | terminar_90 | terminar_99 | cima_inteiro

  -- Desempate manual entre regras do MESMO nível. Maior vence.
  prioridade      INTEGER NOT NULL DEFAULT 0,

  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_por      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE precificacao_regra DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_prec_regra_empresa ON precificacao_regra(empresa_id) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_prec_regra_nivel   ON precificacao_regra(empresa_id, nivel) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_prec_regra_alvo    ON precificacao_regra(alvo_id) WHERE alvo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prec_regra_texto   ON precificacao_regra(empresa_id, alvo_texto) WHERE alvo_texto IS NOT NULL;
