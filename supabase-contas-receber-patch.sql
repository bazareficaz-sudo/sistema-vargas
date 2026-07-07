-- ═══════════════════════════════════════════════════════════════
-- PATCH — Contas a Receber & Crédito de Cliente
-- Execute este arquivo se já existia a tabela contas_receber
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Campos financeiros nos clientes ──────────────────────────
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS permite_fiado              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS limite_credito             NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saldo_devedor              NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_vencido              NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maior_atraso_dias          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bloqueado_fiado            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo_bloqueio            TEXT,
  ADD COLUMN IF NOT EXISTS observacoes_financeiras    TEXT,
  ADD COLUMN IF NOT EXISTS data_ultima_compra_fiada   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_ultimo_pagamento      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS saldo_credito              NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status_credito             TEXT NOT NULL DEFAULT 'liberado';

-- ── 2. Recriar contas_receber com estrutura correta ─────────────
-- (DROP seguro pois não tem dados relevantes ainda)
DROP TABLE IF EXISTS recebimentos CASCADE;
DROP TABLE IF EXISTS credito_utilizacoes CASCADE;
DROP TABLE IF EXISTS contas_receber CASCADE;

CREATE TABLE contas_receber (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL,
  cliente_id      UUID REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome    TEXT NOT NULL,

  origem          TEXT NOT NULL DEFAULT 'manual',
  origem_id       UUID,
  numero_doc      TEXT,
  parcela_numero  INTEGER NOT NULL DEFAULT 1,
  total_parcelas  INTEGER NOT NULL DEFAULT 1,

  data_emissao    DATE NOT NULL DEFAULT CURRENT_DATE,
  data_vencimento DATE NOT NULL,

  valor_original  NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_recebido  NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_aberto    NUMERIC(12,2) GENERATED ALWAYS AS (valor_original - valor_recebido) STORED,
  juros           NUMERIC(12,2) NOT NULL DEFAULT 0,
  multa           NUMERIC(12,2) NOT NULL DEFAULT 0,
  desconto        NUMERIC(12,2) NOT NULL DEFAULT 0,

  status          TEXT NOT NULL DEFAULT 'aberto',
  forma_prevista  TEXT,
  observacao      TEXT,
  operador_nome   TEXT,
  autorizado_por  TEXT,
  renegociacao_id UUID,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cr_empresa     ON contas_receber(empresa_id);
CREATE INDEX IF NOT EXISTS idx_cr_cliente     ON contas_receber(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cr_status      ON contas_receber(status);
CREATE INDEX IF NOT EXISTS idx_cr_vencimento  ON contas_receber(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_cr_origem      ON contas_receber(origem_id);
ALTER TABLE contas_receber DISABLE ROW LEVEL SECURITY;

-- ── 3. Recebimentos ─────────────────────────────────────────────
CREATE TABLE recebimentos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       UUID NOT NULL,
  conta_id         UUID NOT NULL REFERENCES contas_receber(id) ON DELETE CASCADE,
  cliente_id       UUID REFERENCES clientes(id) ON DELETE SET NULL,

  valor            NUMERIC(12,2) NOT NULL DEFAULT 0,
  desconto         NUMERIC(12,2) NOT NULL DEFAULT 0,
  juros            NUMERIC(12,2) NOT NULL DEFAULT 0,
  multa            NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_liquido    NUMERIC(12,2) NOT NULL DEFAULT 0,

  forma_pagamento  TEXT NOT NULL DEFAULT 'dinheiro',
  conta_destino    TEXT,
  observacao       TEXT,
  operador_nome    TEXT,
  credito_id       UUID,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rec_empresa ON recebimentos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_rec_conta   ON recebimentos(conta_id);
ALTER TABLE recebimentos DISABLE ROW LEVEL SECURITY;

-- ── 4. Créditos de Cliente ──────────────────────────────────────
DROP TABLE IF EXISTS creditos_cliente CASCADE;

CREATE TABLE creditos_cliente (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       UUID NOT NULL,
  cliente_id       UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,

  valor_original   NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_utilizado  NUMERIC(12,2) NOT NULL DEFAULT 0,
  saldo_disponivel NUMERIC(12,2) GENERATED ALWAYS AS (valor_original - valor_utilizado) STORED,

  origem           TEXT NOT NULL DEFAULT 'manual',
  origem_id        UUID,
  descricao        TEXT,
  validade         DATE,
  status           TEXT NOT NULL DEFAULT 'disponivel',

  observacao       TEXT,
  operador_nome    TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cred_empresa  ON creditos_cliente(empresa_id);
CREATE INDEX IF NOT EXISTS idx_cred_cliente  ON creditos_cliente(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cred_status   ON creditos_cliente(status);
ALTER TABLE creditos_cliente DISABLE ROW LEVEL SECURITY;

-- ── 5. Utilizações de Crédito ───────────────────────────────────
CREATE TABLE credito_utilizacoes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL,
  credito_id  UUID NOT NULL REFERENCES creditos_cliente(id) ON DELETE CASCADE,
  cliente_id  UUID NOT NULL,
  venda_id    UUID,
  conta_id    UUID REFERENCES contas_receber(id) ON DELETE SET NULL,

  valor       NUMERIC(12,2) NOT NULL DEFAULT 0,
  descricao   TEXT,
  operador    TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE credito_utilizacoes DISABLE ROW LEVEL SECURITY;

-- ── 6. Histórico de Cobrança ────────────────────────────────────
DROP TABLE IF EXISTS cobranca_historico CASCADE;

CREATE TABLE cobranca_historico (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       UUID NOT NULL,
  cliente_id       UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  conta_id         UUID REFERENCES contas_receber(id) ON DELETE SET NULL,

  tipo             TEXT NOT NULL DEFAULT 'contato',
  descricao        TEXT,
  promessa_data    DATE,
  promessa_valor   NUMERIC(12,2),
  operador_nome    TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cob_empresa ON cobranca_historico(empresa_id);
CREATE INDEX IF NOT EXISTS idx_cob_cliente ON cobranca_historico(cliente_id);
ALTER TABLE cobranca_historico DISABLE ROW LEVEL SECURITY;

-- ── 7. Renegociações ────────────────────────────────────────────
DROP TABLE IF EXISTS renegociacoes CASCADE;

CREATE TABLE renegociacoes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       UUID NOT NULL,
  cliente_id       UUID REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome     TEXT,

  valor_original   NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_negociado  NUMERIC(12,2) NOT NULL DEFAULT 0,
  desconto         NUMERIC(12,2) NOT NULL DEFAULT 0,
  juros            NUMERIC(12,2) NOT NULL DEFAULT 0,
  multa            NUMERIC(12,2) NOT NULL DEFAULT 0,

  parcelas         INTEGER NOT NULL DEFAULT 1,
  primeiro_venc    DATE NOT NULL,
  intervalo_dias   INTEGER NOT NULL DEFAULT 30,

  observacao       TEXT,
  operador_nome    TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE renegociacoes DISABLE ROW LEVEL SECURITY;

-- ── 8. Auditoria ────────────────────────────────────────────────
DROP TABLE IF EXISTS cr_auditoria CASCADE;

CREATE TABLE cr_auditoria (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID NOT NULL,
  entidade     TEXT NOT NULL,
  entidade_id  UUID NOT NULL,
  acao         TEXT NOT NULL,
  dados_antes  JSONB,
  dados_depois JSONB,
  operador     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cr_auditoria DISABLE ROW LEVEL SECURITY;
