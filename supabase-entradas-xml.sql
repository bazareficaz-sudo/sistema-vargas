-- ═══════════════════════════════════════════════════════════════
-- MÓDULO ENTRADA DE MERCADORIA POR XML DE NF-e
-- Sistema Vargas — multiempresa
-- ═══════════════════════════════════════════════════════════════

-- ── 1. NF-e Entradas (registro principal) ───────────────────────
CREATE TABLE IF NOT EXISTS nfe_entradas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          UUID NOT NULL,

  -- Identificação
  chave_acesso        TEXT NOT NULL,
  numero              TEXT,
  serie               TEXT,
  modelo              TEXT DEFAULT '55',
  nat_operacao        TEXT,

  -- Datas
  data_emissao        DATE,
  data_entrada        DATE,
  data_importacao     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Fornecedor
  fornecedor_id       UUID REFERENCES fornecedores(id) ON DELETE SET NULL,
  cnpj_fornecedor     TEXT,
  nome_fornecedor     TEXT,
  ie_fornecedor       TEXT,
  uf_fornecedor       TEXT,

  -- Destinatário
  cnpj_destinatario   TEXT,

  -- Valores
  valor_produtos      NUMERIC(14,2) DEFAULT 0,
  valor_frete         NUMERIC(14,2) DEFAULT 0,
  valor_seguro        NUMERIC(14,2) DEFAULT 0,
  valor_desconto      NUMERIC(14,2) DEFAULT 0,
  outras_despesas     NUMERIC(14,2) DEFAULT 0,
  valor_ipi           NUMERIC(14,2) DEFAULT 0,
  valor_icms          NUMERIC(14,2) DEFAULT 0,
  valor_icms_st       NUMERIC(14,2) DEFAULT 0,
  valor_pis           NUMERIC(14,2) DEFAULT 0,
  valor_cofins        NUMERIC(14,2) DEFAULT 0,
  valor_total         NUMERIC(14,2) DEFAULT 0,

  -- Status e origem
  status              TEXT NOT NULL DEFAULT 'xml_importado',
  -- xml_importado | sefaz_encontrada | manifesto_pendente | manifestada
  -- xml_baixado | aguardando_mapeamento | aguardando_conferencia
  -- aguardando_precos | aguardando_financeiro | pronta | finalizada
  -- cancelada | ignorada | erro
  origem              TEXT NOT NULL DEFAULT 'manual',
  -- manual | sefaz

  -- Dados FocusNFe/SEFAZ
  nsu                 TEXT,
  tipo_manifesto      TEXT,
  data_manifesto      TIMESTAMPTZ,
  justificativa       TEXT,

  -- Depósito de destino
  deposito_id         UUID,

  -- XML original
  xml_content         TEXT,

  -- Dados do workflow (JSONB para flexibilidade)
  dados_conferencia   JSONB DEFAULT '{}',
  dados_financeiro    JSONB DEFAULT '{}',

  -- Auditoria
  operador_nome       TEXT,
  finalizado_em       TIMESTAMPTZ,
  finalizado_por      TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(empresa_id, chave_acesso)
);

CREATE INDEX IF NOT EXISTS idx_nfe_empresa   ON nfe_entradas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_nfe_status    ON nfe_entradas(status);
CREATE INDEX IF NOT EXISTS idx_nfe_chave     ON nfe_entradas(chave_acesso);
CREATE INDEX IF NOT EXISTS idx_nfe_fornec    ON nfe_entradas(cnpj_fornecedor);
ALTER TABLE nfe_entradas DISABLE ROW LEVEL SECURITY;

-- ── 2. Itens da NF-e ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nfe_itens (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entrada_id          UUID NOT NULL REFERENCES nfe_entradas(id) ON DELETE CASCADE,
  empresa_id          UUID NOT NULL,

  -- Dados do XML
  num_item            INTEGER NOT NULL,
  codigo_fornecedor   TEXT,
  ean                 TEXT,
  descricao_xml       TEXT NOT NULL,
  ncm                 TEXT,
  cest                TEXT,
  cfop                TEXT,
  unidade_xml         TEXT,
  quantidade_xml      NUMERIC(14,4) DEFAULT 0,
  valor_unitario_xml  NUMERIC(14,6) DEFAULT 0,
  valor_produto       NUMERIC(14,2) DEFAULT 0,
  desconto_item       NUMERIC(14,2) DEFAULT 0,
  frete_item          NUMERIC(14,2) DEFAULT 0,
  seguro_item         NUMERIC(14,2) DEFAULT 0,
  outras_desp_item    NUMERIC(14,2) DEFAULT 0,

  -- Impostos
  ipi                 NUMERIC(14,2) DEFAULT 0,
  icms                NUMERIC(14,2) DEFAULT 0,
  icms_st             NUMERIC(14,2) DEFAULT 0,
  pis                 NUMERIC(14,2) DEFAULT 0,
  cofins              NUMERIC(14,2) DEFAULT 0,

  -- Custo calculado
  custo_unitario      NUMERIC(14,6) DEFAULT 0,
  custo_total         NUMERIC(14,2) DEFAULT 0,

  -- Conferência
  quantidade_conferida NUMERIC(14,4),
  observacao_conferencia TEXT,

  -- Mapeamento
  produto_id          UUID REFERENCES produtos(id) ON DELETE SET NULL,
  produto_sku         TEXT,
  produto_nome        TEXT,
  unidade_sistema     TEXT,
  fator_conversao     NUMERIC(14,4) DEFAULT 1,
  quantidade_entrada  NUMERIC(14,4) DEFAULT 0,
  status_mapeamento   TEXT DEFAULT 'nao_mapeado',
  -- nao_mapeado | auto | manual | novo_produto | ignorado

  -- Preço
  preco_atual         NUMERIC(14,2) DEFAULT 0,
  custo_anterior      NUMERIC(14,2) DEFAULT 0,
  novo_preco          NUMERIC(14,2),
  atualizar_preco     BOOLEAN DEFAULT false,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nfe_itens_entrada ON nfe_itens(entrada_id);
CREATE INDEX IF NOT EXISTS idx_nfe_itens_produto  ON nfe_itens(produto_id);
ALTER TABLE nfe_itens DISABLE ROW LEVEL SECURITY;

-- ── 3. Duplicatas (contas a pagar geradas) ──────────────────────
CREATE TABLE IF NOT EXISTS nfe_duplicatas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entrada_id      UUID NOT NULL REFERENCES nfe_entradas(id) ON DELETE CASCADE,
  empresa_id      UUID NOT NULL,
  num_dup         TEXT,
  data_vencimento DATE NOT NULL,
  valor           NUMERIC(14,2) NOT NULL DEFAULT 0,
  forma_pagamento TEXT,
  conta_pagar_id  UUID,  -- referência após gerar
  gerado          BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE nfe_duplicatas DISABLE ROW LEVEL SECURITY;

-- ── 4. Histórico de mapeamentos (fornecedor x produto) ──────────
CREATE TABLE IF NOT EXISTS nfe_mapeamentos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          UUID NOT NULL,
  cnpj_fornecedor     TEXT NOT NULL,
  codigo_fornecedor   TEXT,
  ean                 TEXT,
  descricao_xml       TEXT,
  produto_id          UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  unidade_xml         TEXT,
  unidade_sistema     TEXT,
  fator_conversao     NUMERIC(14,4) DEFAULT 1,
  ultimo_custo        NUMERIC(14,6) DEFAULT 0,
  ultima_entrada_id   UUID REFERENCES nfe_entradas(id) ON DELETE SET NULL,
  operador            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(empresa_id, cnpj_fornecedor, codigo_fornecedor)
);

CREATE INDEX IF NOT EXISTS idx_mapa_empresa ON nfe_mapeamentos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_mapa_cnpj    ON nfe_mapeamentos(cnpj_fornecedor);
CREATE INDEX IF NOT EXISTS idx_mapa_ean     ON nfe_mapeamentos(ean);
ALTER TABLE nfe_mapeamentos DISABLE ROW LEVEL SECURITY;

-- ── 5. Logs / Auditoria ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nfe_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL,
  entrada_id  UUID REFERENCES nfe_entradas(id) ON DELETE CASCADE,
  acao        TEXT NOT NULL,
  descricao   TEXT,
  dados       JSONB,
  operador    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nfe_logs_entrada ON nfe_logs(entrada_id);
ALTER TABLE nfe_logs DISABLE ROW LEVEL SECURITY;

-- ── 6. Configuração SEFAZ/FocusNFe por empresa ──────────────────
CREATE TABLE IF NOT EXISTS nfe_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL UNIQUE,
  cnpj            TEXT,
  focusnfe_token  TEXT,
  ultimo_nsu      TEXT DEFAULT '0',
  ambiente        TEXT DEFAULT 'producao',  -- producao | homologacao
  ativo           BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE nfe_config DISABLE ROW LEVEL SECURITY;
