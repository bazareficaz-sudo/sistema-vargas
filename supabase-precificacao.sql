-- ============================================================
-- Motor de Precificação Inteligente — Fase 1
--
-- Uma linha por canal (ou por marketplace, quando canal_id é nulo) com TODAS
-- as taxas em dado, não em código. Adicionar um marketplace novo passa a ser
-- cadastro, não desenvolvimento.
--
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS precificacao_config (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          UUID NOT NULL,
  -- NULL = configuração padrão da plataforma para a empresa; preenchido =
  -- configuração específica daquele canal (que prevalece sobre a padrão).
  canal_id            UUID REFERENCES marketplace_canais(id) ON DELETE CASCADE,
  plataforma          TEXT NOT NULL,              -- shopee | mercadolivre | ...
  nome                TEXT NOT NULL,

  -- Comissão
  comissao_modo       TEXT NOT NULL DEFAULT 'faixas',  -- faixas | simples | api_ml
  comissao_percentual NUMERIC(6,3) NOT NULL DEFAULT 0,
  comissao_fixo       NUMERIC(10,2) NOT NULL DEFAULT 0,
  comissao_faixas     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{min,max,percentual,fixo}]

  -- Outras taxas do marketplace: [{nome,tipo:'fixo'|'percentual',valor,base}]
  taxas               JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Frete
  frete_modo          TEXT NOT NULL DEFAULT 'nao',  -- nao | fixo | gratis_acima | faixa_peso
  frete_valor         NUMERIC(10,2) NOT NULL DEFAULT 0,
  frete_limite_gratis NUMERIC(10,2) NOT NULL DEFAULT 0,
  frete_custo_medio   NUMERIC(10,2) NOT NULL DEFAULT 0,
  frete_faixas        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{pesoAte,valor}]

  -- Componentes de custo (mesmo formato de `taxas`, um objeto só)
  embalagem           JSONB,
  imposto             JSONB,
  custos_extras       JSONB NOT NULL DEFAULT '[]'::jsonb,

  dias_recebimento    INTEGER,

  -- Faixas do indicador de saúde (% de margem líquida)
  saude_critica       NUMERIC(6,2) NOT NULL DEFAULT 5,
  saude_baixa         NUMERIC(6,2) NOT NULL DEFAULT 10,
  saude_saudavel      NUMERIC(6,2) NOT NULL DEFAULT 20,

  ativo               BOOLEAN NOT NULL DEFAULT true,
  criado_por          UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE precificacao_config DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_precificacao_empresa ON precificacao_config(empresa_id);
CREATE INDEX IF NOT EXISTS idx_precificacao_canal   ON precificacao_config(canal_id);

-- Só uma configuração por canal, e uma padrão por plataforma/empresa.
CREATE UNIQUE INDEX IF NOT EXISTS idx_precificacao_canal_unico
  ON precificacao_config(canal_id) WHERE canal_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_precificacao_padrao_unico
  ON precificacao_config(empresa_id, plataforma) WHERE canal_id IS NULL;

-- ============================================================
-- Cache da comissão real do Mercado Livre.
--
-- A alíquota do ML muda por categoria E por faixa de preço (medido na conta
-- real: 11,5% a R$ 25 e 10,5% a R$ 250 na mesma categoria). Consultar a API a
-- cada cálculo seria lento e estouraria limite de requisição, então o valor
-- fica guardado aqui por algumas horas.
-- ============================================================

CREATE TABLE IF NOT EXISTS precificacao_ml_comissao_cache (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canal_id       UUID NOT NULL REFERENCES marketplace_canais(id) ON DELETE CASCADE,
  categoria_id   TEXT NOT NULL,
  listing_type   TEXT NOT NULL,
  faixas         JSONB NOT NULL,   -- [{min,max,percentual,fixo}] montado a partir da API
  buscado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (canal_id, categoria_id, listing_type)
);

ALTER TABLE precificacao_ml_comissao_cache DISABLE ROW LEVEL SECURITY;
