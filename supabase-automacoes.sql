-- ============================================================
-- Central de Automações — tabela única polimórfica
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS automacoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL,
  nome           TEXT NOT NULL,
  tipo           TEXT NOT NULL,
  ativa          BOOLEAN NOT NULL DEFAULT true,
  observacao     TEXT,

  -- condições (significado varia por `tipo` — ver módulos no app)
  produtos              JSONB,              -- [{produto_id, produto_nome, produto_sku}]
  forma_pagamento       TEXT,
  canal_venda           TEXT,
  marketplace_canal_id  UUID REFERENCES marketplace_canais(id) ON DELETE SET NULL,
  cliente_id            UUID REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome          TEXT,
  modelo_fiscal         TEXT,
  numero_destino        TEXT,
  horario_envio         TEXT,
  tipo_relatorio        TEXT,
  dias_alerta           INTEGER,
  limite_estoque        NUMERIC(12,2),

  -- controle de execução
  cursor_processado    TIMESTAMPTZ,  -- até onde já processou (tipos avaliados por novos registros)
  ultima_execucao_dia  DATE,         -- dedup dos tipos agendados 1x/dia (por horario_envio)
  ultima_execucao      TIMESTAMPTZ,
  total_execucoes      INTEGER NOT NULL DEFAULT 0,
  ultimo_status        TEXT,
  ultimo_erro          TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE automacoes DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_automacoes_empresa ON automacoes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_automacoes_tipo    ON automacoes(tipo);
CREATE INDEX IF NOT EXISTS idx_automacoes_ativa    ON automacoes(ativa);
