-- ============================================================
-- MÓDULO INCENTIVOS COMERCIAIS
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. PLANOS DE INCENTIVO
-- Sem REFERENCES empresas(id) para não depender do módulo SaaS
CREATE TABLE IF NOT EXISTS incentivo_planos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL,
  tenant_id       UUID,
  nome            TEXT NOT NULL,
  descricao       TEXT,
  tipo            TEXT NOT NULL DEFAULT 'comissao'
                  CHECK (tipo IN ('comissao','meta','bonus','premiacao','cashback','campanha','gamificacao')),
  status          TEXT DEFAULT 'rascunho'
                  CHECK (status IN ('rascunho','ativo','pausado','encerrado')),
  prioridade      INTEGER DEFAULT 0,
  vigencia_inicio DATE,
  vigencia_fim    DATE,
  abrangencia     TEXT DEFAULT 'empresa'
                  CHECK (abrangencia IN ('empresa','grupo','global')),
  recorrencia     TEXT DEFAULT 'nenhuma'
                  CHECK (recorrencia IN ('nenhuma','mensal','trimestral','semestral','anual')),
  icone           TEXT,
  cor             TEXT,
  observacoes     TEXT,
  ativo           BOOLEAN DEFAULT true,
  criado_por      UUID,
  aprovado_por    UUID,
  aprovado_em     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE incentivo_planos DISABLE ROW LEVEL SECURITY;

-- 2. REGRAS DE COMISSÃO
CREATE TABLE IF NOT EXISTS incentivo_regras (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id    UUID NOT NULL REFERENCES incentivo_planos(id) ON DELETE CASCADE,
  nome        TEXT,
  tipo        TEXT NOT NULL
              CHECK (tipo IN ('percentual','fixo_unidade','fixo_venda','progressivo',
                              'por_lucro','por_margem','pontos','cliente_novo','cliente_recup')),
  alvo_tipo   TEXT DEFAULT 'geral'
              CHECK (alvo_tipo IN ('geral','categoria','subcategoria','marca','fornecedor',
                                   'tag','canal','forma_pagamento','produto','kit','combo')),
  alvo_nomes  TEXT[],
  alvo_ids    TEXT[],
  valor       NUMERIC(10,4) DEFAULT 0,
  configuracao JSONB,
  condicoes   JSONB,
  ordem       INTEGER DEFAULT 0,
  ativo       BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE incentivo_regras DISABLE ROW LEVEL SECURITY;

-- 3. METAS
CREATE TABLE IF NOT EXISTS incentivo_metas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id     UUID NOT NULL REFERENCES incentivo_planos(id) ON DELETE CASCADE,
  nome         TEXT NOT NULL,
  tipo         TEXT NOT NULL DEFAULT 'valor'
               CHECK (tipo IN ('valor','quantidade','lucro','margem','clientes',
                               'novos_clientes','ticket_medio','conversao','produtos',
                               'categoria','marca','tag')),
  alvo_tipo    TEXT DEFAULT 'individual'
               CHECK (alvo_tipo IN ('individual','equipe','empresa')),
  valor_meta   NUMERIC(14,2),
  periodo      TEXT DEFAULT 'mensal'
               CHECK (periodo IN ('diario','semanal','mensal','trimestral','semestral','anual','campanha')),
  descricao    TEXT,
  ativo        BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE incentivo_metas DISABLE ROW LEVEL SECURITY;

-- 4. BÔNUS
CREATE TABLE IF NOT EXISTS incentivo_bonus (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id         UUID NOT NULL REFERENCES incentivo_planos(id) ON DELETE CASCADE,
  meta_id          UUID REFERENCES incentivo_metas(id),
  nome             TEXT NOT NULL,
  tipo             TEXT DEFAULT 'fixo'
                   CHECK (tipo IN ('percentual','fixo','voucher','folga','premio_fisico','pontos')),
  valor            NUMERIC(10,2),
  descricao        TEXT,
  criterio         TEXT DEFAULT 'meta_100'
                   CHECK (criterio IN ('meta_80','meta_100','meta_120','top1','top3','top10','todos')),
  percentual_meta  NUMERIC(5,2) DEFAULT 100,
  ativo            BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE incentivo_bonus DISABLE ROW LEVEL SECURITY;

-- 5. PARTICIPANTES
-- vendedor_id UUID para ser compatível com vendedores.id UUID
-- Sem REFERENCES empresas(id)
CREATE TABLE IF NOT EXISTS incentivo_participantes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id         UUID NOT NULL REFERENCES incentivo_planos(id) ON DELETE CASCADE,
  vendedor_id      UUID REFERENCES vendedores(id) ON DELETE CASCADE,
  todos_vendedores BOOLEAN DEFAULT false,
  empresa_id       UUID,
  ativo            BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(plano_id, vendedor_id)
);
ALTER TABLE incentivo_participantes DISABLE ROW LEVEL SECURITY;

-- 6. RESULTADOS / APURAÇÃO
CREATE TABLE IF NOT EXISTS incentivo_resultados (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id              UUID NOT NULL REFERENCES incentivo_planos(id),
  vendedor_id           UUID NOT NULL REFERENCES vendedores(id),
  empresa_id            UUID,
  periodo_inicio        DATE NOT NULL,
  periodo_fim           DATE NOT NULL,
  valor_vendido         NUMERIC(14,2) DEFAULT 0,
  valor_base_comissao   NUMERIC(14,2) DEFAULT 0,
  comissao_calculada    NUMERIC(14,2) DEFAULT 0,
  bonus_calculado       NUMERIC(14,2) DEFAULT 0,
  pontos_ganhos         INTEGER DEFAULT 0,
  meta_valor            NUMERIC(14,2),
  meta_atingida         NUMERIC(14,2) DEFAULT 0,
  percentual_meta       NUMERIC(5,2) DEFAULT 0,
  meta_batida           BOOLEAN DEFAULT false,
  status                TEXT DEFAULT 'pendente'
                        CHECK (status IN ('pendente','aprovado','pago','cancelado')),
  aprovado_por          UUID,
  aprovado_em           TIMESTAMPTZ,
  pago_em               TIMESTAMPTZ,
  observacao            TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE incentivo_resultados DISABLE ROW LEVEL SECURITY;

-- 7. HISTÓRICO
CREATE TABLE IF NOT EXISTS incentivo_historico (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id        UUID REFERENCES incentivo_planos(id),
  regra_id        UUID REFERENCES incentivo_regras(id),
  vendedor_id     UUID REFERENCES vendedores(id),
  empresa_id      UUID,
  venda_id        TEXT,
  produto_id      TEXT,
  produto_nome    TEXT,
  tipo            TEXT,
  valor_venda     NUMERIC(14,2),
  valor_base      NUMERIC(14,2),
  percentual      NUMERIC(10,4),
  valor_incentivo NUMERIC(14,2),
  pontos          INTEGER DEFAULT 0,
  descricao       TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE incentivo_historico DISABLE ROW LEVEL SECURITY;

-- 8. PONTOS (gamificação)
CREATE TABLE IF NOT EXISTS incentivo_pontos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedor_id   UUID NOT NULL REFERENCES vendedores(id),
  empresa_id    UUID,
  plano_id      UUID REFERENCES incentivo_planos(id),
  pontos        INTEGER DEFAULT 0,
  tipo          TEXT CHECK (tipo IN ('ganho','expirado','resgatado')),
  descricao     TEXT,
  referencia_id TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE incentivo_pontos DISABLE ROW LEVEL SECURITY;

-- 9. PREMIAÇÕES
CREATE TABLE IF NOT EXISTS incentivo_premiacoes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id              UUID REFERENCES incentivo_planos(id),
  empresa_id            UUID,
  nome                  TEXT NOT NULL,
  descricao             TEXT,
  tipo                  TEXT DEFAULT 'fisico'
                        CHECK (tipo IN ('fisico','voucher','viagem','folga','dinheiro','pontos')),
  valor                 NUMERIC(10,2),
  pontos_necessarios    INTEGER,
  imagem_url            TEXT,
  quantidade_disponivel INTEGER,
  criterio              TEXT,
  data_entrega          DATE,
  ativo                 BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE incentivo_premiacoes DISABLE ROW LEVEL SECURITY;

-- 10. RANKING snapshot
CREATE TABLE IF NOT EXISTS incentivo_ranking (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       UUID,
  plano_id         UUID REFERENCES incentivo_planos(id),
  periodo          TEXT,
  posicao          INTEGER,
  vendedor_id      UUID REFERENCES vendedores(id),
  valor_vendido    NUMERIC(14,2),
  comissao         NUMERIC(14,2),
  meta_percentual  NUMERIC(5,2),
  pontos           INTEGER,
  calculated_at    TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE incentivo_ranking DISABLE ROW LEVEL SECURITY;

-- 11. TAGS DE PRODUTO
CREATE TABLE IF NOT EXISTS produto_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id  TEXT NOT NULL,
  empresa_id  UUID NOT NULL,
  tag         TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(produto_id, empresa_id, tag)
);
ALTER TABLE produto_tags DISABLE ROW LEVEL SECURITY;

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS tags TEXT[];

-- ÍNDICES
CREATE INDEX IF NOT EXISTS idx_inc_planos_empresa   ON incentivo_planos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_inc_planos_status    ON incentivo_planos(status);
CREATE INDEX IF NOT EXISTS idx_inc_planos_vigencia  ON incentivo_planos(vigencia_inicio, vigencia_fim);
CREATE INDEX IF NOT EXISTS idx_inc_regras_plano     ON incentivo_regras(plano_id);
CREATE INDEX IF NOT EXISTS idx_inc_metas_plano      ON incentivo_metas(plano_id);
CREATE INDEX IF NOT EXISTS idx_inc_bonus_plano      ON incentivo_bonus(plano_id);
CREATE INDEX IF NOT EXISTS idx_inc_part_plano       ON incentivo_participantes(plano_id);
CREATE INDEX IF NOT EXISTS idx_inc_part_vendedor    ON incentivo_participantes(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_inc_result_plano     ON incentivo_resultados(plano_id);
CREATE INDEX IF NOT EXISTS idx_inc_result_vendedor  ON incentivo_resultados(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_inc_hist_vendedor    ON incentivo_historico(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_produto_tags_prod    ON produto_tags(produto_id);
CREATE INDEX IF NOT EXISTS idx_produto_tags_tag     ON produto_tags(tag);
