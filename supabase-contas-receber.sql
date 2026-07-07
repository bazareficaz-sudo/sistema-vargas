-- ═══════════════════════════════════════════════════════════════
-- MÓDULO CONTAS A RECEBER & CRÉDITO DE CLIENTE
-- Sistema Vargas — multiempresa
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Campos financeiros nos clientes ──────────────────────────
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS permite_fiado         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS limite_credito         NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saldo_devedor          NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_vencido          NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maior_atraso_dias      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bloqueado_fiado        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo_bloqueio        TEXT,
  ADD COLUMN IF NOT EXISTS observacoes_financeiras TEXT,
  ADD COLUMN IF NOT EXISTS data_ultima_compra_fiada TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_ultimo_pagamento   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS saldo_credito           NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status_credito          TEXT NOT NULL DEFAULT 'liberado';

-- ── 2. Contas a Receber ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contas_receber (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cliente_id      UUID REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome    TEXT NOT NULL,

  -- Origem
  origem          TEXT NOT NULL DEFAULT 'manual',
  -- 'venda','orcamento','pdv','marketplace','manual','credito_devolucao'
  origem_id       UUID,
  numero_doc      TEXT,
  parcela_numero  INTEGER NOT NULL DEFAULT 1,
  total_parcelas  INTEGER NOT NULL DEFAULT 1,

  -- Datas
  data_emissao    DATE NOT NULL DEFAULT CURRENT_DATE,
  data_vencimento DATE NOT NULL,

  -- Valores
  valor_original  NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_recebido  NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_aberto    NUMERIC(12,2) GENERATED ALWAYS AS (valor_original - valor_recebido) STORED,
  juros           NUMERIC(12,2) NOT NULL DEFAULT 0,
  multa           NUMERIC(12,2) NOT NULL DEFAULT 0,
  desconto        NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Status
  status          TEXT NOT NULL DEFAULT 'aberto',
  -- 'aberto','parcial','recebido','vencido','cancelado','renegociado'

  forma_prevista  TEXT,
  observacao      TEXT,
  operador_nome   TEXT,
  autorizado_por  TEXT,

  -- Renegociação
  renegociacao_id UUID,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cr_empresa     ON contas_receber(empresa_id);
CREATE INDEX IF NOT EXISTS idx_cr_cliente     ON contas_receber(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cr_status      ON contas_receber(status);
CREATE INDEX IF NOT EXISTS idx_cr_vencimento  ON contas_receber(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_cr_origem      ON contas_receber(origem_id);

-- ── 3. Recebimentos (baixas parciais ou totais) ─────────────────
CREATE TABLE IF NOT EXISTS recebimentos (
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

  credito_id       UUID,  -- se usou crédito

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rec_empresa ON recebimentos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_rec_conta   ON recebimentos(conta_id);

-- ── 4. Créditos de Cliente ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS creditos_cliente (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       UUID NOT NULL,
  cliente_id       UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,

  valor_original   NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_utilizado  NUMERIC(12,2) NOT NULL DEFAULT 0,
  saldo_disponivel NUMERIC(12,2) GENERATED ALWAYS AS (valor_original - valor_utilizado) STORED,

  origem           TEXT NOT NULL DEFAULT 'manual',
  -- 'troca','devolucao','adiantamento','ajuste','pagamento_excedente'
  origem_id        UUID,
  descricao        TEXT,

  validade         DATE,
  status           TEXT NOT NULL DEFAULT 'disponivel',
  -- 'disponivel','parcial','utilizado','cancelado','expirado'

  observacao       TEXT,
  operador_nome    TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cred_empresa  ON creditos_cliente(empresa_id);
CREATE INDEX IF NOT EXISTS idx_cred_cliente  ON creditos_cliente(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cred_status   ON creditos_cliente(status);

-- ── 5. Utilizações de Crédito ───────────────────────────────────
CREATE TABLE IF NOT EXISTS credito_utilizacoes (
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

-- ── 6. Histórico de Cobrança ────────────────────────────────────
CREATE TABLE IF NOT EXISTS cobranca_historico (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       UUID NOT NULL,
  cliente_id       UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  conta_id         UUID REFERENCES contas_receber(id) ON DELETE SET NULL,

  tipo             TEXT NOT NULL DEFAULT 'contato',
  -- 'contato','whatsapp','promessa','renegociacao','bloqueio'
  descricao        TEXT,
  promessa_data    DATE,
  promessa_valor   NUMERIC(12,2),
  operador_nome    TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cob_empresa ON cobranca_historico(empresa_id);
CREATE INDEX IF NOT EXISTS idx_cob_cliente ON cobranca_historico(cliente_id);

-- ── 7. Renegociações ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS renegociacoes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       UUID NOT NULL,
  cliente_id       UUID REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome     TEXT,

  valor_original   NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_negociado  NUMERIC(12,2) NOT NULL DEFAULT 0,
  desconto         NUMERIC(12,2) NOT NULL DEFAULT 0,
  juros            NUMERIC(12,2) NOT NULL DEFAULT 0,

  parcelas         INTEGER NOT NULL DEFAULT 1,
  primeiro_venc    DATE NOT NULL,
  intervalo_dias   INTEGER NOT NULL DEFAULT 30,

  observacao       TEXT,
  operador_nome    TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 8. Auditoria ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cr_auditoria (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID NOT NULL,
  entidade     TEXT NOT NULL,  -- 'conta','credito','cliente'
  entidade_id  UUID NOT NULL,
  acao         TEXT NOT NULL,
  dados_antes  JSONB,
  dados_depois JSONB,
  operador     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 9. Atualizar status vencidos (trigger) ──────────────────────
CREATE OR REPLACE FUNCTION atualizar_status_vencidos()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE contas_receber
  SET status = 'vencido', updated_at = NOW()
  WHERE status = 'aberto'
    AND data_vencimento < CURRENT_DATE;
END;
$$;

-- ── 10. RLS desativado (padrão do sistema) ──────────────────────
ALTER TABLE contas_receber       DISABLE ROW LEVEL SECURITY;
ALTER TABLE recebimentos         DISABLE ROW LEVEL SECURITY;
ALTER TABLE creditos_cliente     DISABLE ROW LEVEL SECURITY;
ALTER TABLE credito_utilizacoes  DISABLE ROW LEVEL SECURITY;
ALTER TABLE cobranca_historico   DISABLE ROW LEVEL SECURITY;
ALTER TABLE renegociacoes        DISABLE ROW LEVEL SECURITY;
ALTER TABLE cr_auditoria         DISABLE ROW LEVEL SECURITY;
