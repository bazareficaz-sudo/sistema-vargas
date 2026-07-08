-- ============================================================
-- MÓDULO SAÚDE DA VENDA E NEGOCIAÇÃO INTELIGENTE
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. CONFIGURAÇÃO DE TAXAS E CUSTOS POR EMPRESA
CREATE TABLE IF NOT EXISTS saude_config (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                UUID NOT NULL UNIQUE,
  -- Taxas de pagamento
  taxa_pix_pct              NUMERIC(5,2) DEFAULT 0,
  taxa_dinheiro_pct         NUMERIC(5,2) DEFAULT 0,
  taxa_debito_pct           NUMERIC(5,2) DEFAULT 1.5,
  taxa_credito_vista_pct    NUMERIC(5,2) DEFAULT 2.5,
  taxa_credito_parc_pct     NUMERIC(5,2) DEFAULT 1.5,  -- adicional por parcela extra
  taxa_carteira_pct         NUMERIC(5,2) DEFAULT 0,
  taxa_fiado_pct            NUMERIC(5,2) DEFAULT 0,
  taxa_marketplace_pct      NUMERIC(5,2) DEFAULT 12,
  -- Custos operacionais
  imposto_pct               NUMERIC(5,2) DEFAULT 0,
  custo_operacional_pct     NUMERIC(5,2) DEFAULT 5,
  comissao_vendedor_pct     NUMERIC(5,2) DEFAULT 3,
  custo_embalagem           NUMERIC(10,2) DEFAULT 0,
  frete_subsidiado_pct      NUMERIC(5,2) DEFAULT 0,
  -- Metas de margem
  margem_minima_desejada    NUMERIC(5,2) DEFAULT 25,
  margem_minima_absoluta    NUMERIC(5,2) DEFAULT 10,
  -- Controles
  exibir_custo_vendedor     BOOLEAN DEFAULT false,
  exibir_lucro_vendedor     BOOLEAN DEFAULT false,
  exibir_margem_vendedor    BOOLEAN DEFAULT false,
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE saude_config DISABLE ROW LEVEL SECURITY;

-- 2. FAIXAS DE SAÚDE (configuráveis por empresa)
CREATE TABLE IF NOT EXISTS saude_faixas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            UUID NOT NULL,
  nome                  TEXT NOT NULL,
  emoji                 TEXT DEFAULT '🟢',
  cor                   TEXT DEFAULT '#22c55e',
  cor_fundo             TEXT DEFAULT '#f0fdf4',
  margem_min            NUMERIC(5,2),   -- NULL = sem limite inferior
  margem_max            NUMERIC(5,2),   -- NULL = sem limite superior
  desconto_max_pct      NUMERIC(5,2) DEFAULT 0,
  exige_autorizacao     BOOLEAN DEFAULT false,
  bloqueia_venda        BOOLEAN DEFAULT false,
  mensagem_vendedor     TEXT,
  mensagem_gerente      TEXT,
  formas_permitidas     TEXT[],         -- NULL = todas permitidas
  formas_bloqueadas     TEXT[],
  permite_parcelamento  BOOLEAN DEFAULT true,
  max_parcelas          INTEGER DEFAULT 12,
  ordem                 INTEGER DEFAULT 0,
  ativo                 BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE saude_faixas DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_saude_faixas_empresa ON saude_faixas(empresa_id);

-- 3. LOG DE AUTORIZAÇÕES GERENCIAIS
CREATE TABLE IF NOT EXISTS saude_autorizacoes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL,
  venda_id          TEXT,
  orcamento_id      UUID,
  vendedor_id       UUID,
  vendedor_nome     TEXT,
  autorizador_nome  TEXT,
  motivo            TEXT,
  observacao        TEXT,
  margem_antes      NUMERIC(5,2),
  margem_depois     NUMERIC(5,2),
  desconto_aplicado NUMERIC(10,2),
  forma_pagamento   TEXT,
  total_venda       NUMERIC(10,2),
  faixa_nome        TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE saude_autorizacoes DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_saude_autorizacoes_empresa ON saude_autorizacoes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_saude_autorizacoes_venda   ON saude_autorizacoes(venda_id);

-- 4. FAIXAS PADRÃO (inseridas na primeira vez que a empresa configurar)
-- (Executadas via função para não duplicar)
CREATE OR REPLACE FUNCTION inserir_faixas_padrao(p_empresa_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM saude_faixas WHERE empresa_id = p_empresa_id) THEN RETURN; END IF;

  INSERT INTO saude_faixas (empresa_id, nome, emoji, cor, cor_fundo, margem_min, margem_max, desconto_max_pct, exige_autorizacao, bloqueia_venda, mensagem_vendedor, formas_permitidas, permite_parcelamento, max_parcelas, ordem)
  VALUES
    (p_empresa_id, 'Excelente', '🟢', '#16a34a', '#f0fdf4', 35,   NULL, 10,  false, false, 'Venda com ótima margem. Você pode conceder desconto normalmente.',               NULL,                                           true,  12, 1),
    (p_empresa_id, 'Boa',       '🟡', '#ca8a04', '#fefce8', 25,   35,   5,   false, false, 'Venda saudável. Desconto moderado permitido.',                                  ARRAY['pix','dinheiro','debito','credito'],      true,  3,  2),
    (p_empresa_id, 'Atenção',   '🟠', '#ea580c', '#fff7ed', 15,   25,   2,   false, false, 'Margem baixa. Desconto muito limitado. Prefira PIX ou débito.',                 ARRAY['pix','dinheiro','debito'],               false, 1,  3),
    (p_empresa_id, 'Crítica',   '🔴', '#dc2626', '#fef2f2', 5,    15,   0,   true,  false, 'Margem muito baixa. Qualquer desconto exige autorização do gerente.',           ARRAY['pix','dinheiro'],                        false, 1,  4),
    (p_empresa_id, 'Prejuízo',  '⚫', '#1c1917', '#fafaf9', NULL, 5,    0,   true,  true,  'Venda gerando prejuízo. Finalização bloqueada sem autorização gerencial.',      ARRAY['pix','dinheiro'],                        false, 1,  5);
END;
$$;
