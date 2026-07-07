-- ═══════════════════════════════════════════════════════════════════════
--  SISTEMA VARGAS — Estrutura SaaS Multi-Empresa
--  Criação: 2026-07-07
--  Objetivo: Preparar o sistema para múltiplas empresas/grupos/tenants
-- ═══════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────
--  1. TENANTS — Clientes SaaS (quem contrata o sistema)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  slug        TEXT UNIQUE,
  plano       TEXT NOT NULL DEFAULT 'essencial'
                CHECK (plano IN ('essencial', 'profissional', 'enterprise')),
  status      TEXT NOT NULL DEFAULT 'ativo'
                CHECK (status IN ('ativo', 'suspenso', 'cancelado')),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;

-- Tenant padrão (Grupo Vargas / Bazar Eficaz)
INSERT INTO tenants (id, nome, slug, plano)
VALUES ('b0000000-0000-0000-0000-000000000001'::uuid, 'Grupo Vargas', 'grupo-vargas', 'profissional')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────
--  2. GRUPOS EMPRESARIAIS — Conjunto de CNPJs do mesmo dono
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS grupos_empresariais (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  descricao   TEXT,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE grupos_empresariais DISABLE ROW LEVEL SECURITY;

-- Grupo padrão
INSERT INTO grupos_empresariais (id, tenant_id, nome, descricao)
VALUES (
  'c0000000-0000-0000-0000-000000000001'::uuid,
  'b0000000-0000-0000-0000-000000000001'::uuid,
  'Grupo Principal',
  'Grupo empresarial padrão'
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────
--  3. EMPRESAS — Cada CNPJ / unidade operacional
--  (A tabela já existe; usamos ALTER TABLE para adicionar colunas)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE empresas DISABLE ROW LEVEL SECURITY;

-- Vínculos SaaS
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS tenant_id   UUID REFERENCES tenants(id),
  ADD COLUMN IF NOT EXISTS grupo_id    UUID REFERENCES grupos_empresariais(id);

-- Dados básicos
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS razao_social        TEXT,
  ADD COLUMN IF NOT EXISTS nome_fantasia        TEXT,
  ADD COLUMN IF NOT EXISTS cnpj                TEXT,
  ADD COLUMN IF NOT EXISTS inscricao_estadual  TEXT,
  ADD COLUMN IF NOT EXISTS inscricao_municipal TEXT,
  ADD COLUMN IF NOT EXISTS regime_tributario   TEXT DEFAULT 'simples_nacional'
    CHECK (regime_tributario IN ('simples_nacional','lucro_presumido','lucro_real','mei','isento','outro')),
  ADD COLUMN IF NOT EXISTS cnae                TEXT,
  ADD COLUMN IF NOT EXISTS status              TEXT DEFAULT 'ativa'
    CHECK (status IN ('ativa','inativa','suspensa','em_implantacao')),
  ADD COLUMN IF NOT EXISTS empresa_principal   BOOLEAN DEFAULT false;

-- Endereço
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS cep          TEXT,
  ADD COLUMN IF NOT EXISTS logradouro   TEXT,
  ADD COLUMN IF NOT EXISTS numero       TEXT,
  ADD COLUMN IF NOT EXISTS complemento  TEXT,
  ADD COLUMN IF NOT EXISTS bairro       TEXT,
  ADD COLUMN IF NOT EXISTS cidade       TEXT,
  ADD COLUMN IF NOT EXISTS uf           TEXT,
  ADD COLUMN IF NOT EXISTS ibge         TEXT,
  ADD COLUMN IF NOT EXISTS pais         TEXT DEFAULT 'Brasil';

-- Contato
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS telefone         TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp         TEXT,
  ADD COLUMN IF NOT EXISTS email            TEXT,
  ADD COLUMN IF NOT EXISTS email_financeiro TEXT,
  ADD COLUMN IF NOT EXISTS email_fiscal     TEXT,
  ADD COLUMN IF NOT EXISTS site             TEXT;

-- Responsáveis
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS responsavel_legal   TEXT,
  ADD COLUMN IF NOT EXISTS cpf_responsavel     TEXT,
  ADD COLUMN IF NOT EXISTS contador            TEXT,
  ADD COLUMN IF NOT EXISTS email_contador      TEXT,
  ADD COLUMN IF NOT EXISTS telefone_contador   TEXT;

-- Identidade visual
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS logo_url     TEXT,
  ADD COLUMN IF NOT EXISTS cor_primaria TEXT DEFAULT '#2563eb',
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT now();

-- Vincular empresa existente ao tenant e grupo padrão
UPDATE empresas
SET
  tenant_id         = 'b0000000-0000-0000-0000-000000000001',
  grupo_id          = 'c0000000-0000-0000-0000-000000000001',
  empresa_principal = true,
  status            = 'ativa',
  regime_tributario = 'simples_nacional'
WHERE id = 'a1000000-0000-0000-0000-000000000001'::uuid;

-- ─────────────────────────────────────────────────────────
--  4. EMPRESA_CONFIG_FISCAL
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresa_config_fiscal (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          UUID NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE CASCADE,
  ambiente            TEXT NOT NULL DEFAULT 'homologacao'
                        CHECK (ambiente IN ('homologacao','producao')),
  serie_nfe           INTEGER NOT NULL DEFAULT 1,
  serie_nfce          INTEGER NOT NULL DEFAULT 1,
  proximo_nfe         INTEGER NOT NULL DEFAULT 1,
  proximo_nfce        INTEGER NOT NULL DEFAULT 1,
  csc_nfce            TEXT,
  id_csc_nfce         TEXT,
  certificado_validade DATE,
  certificado_ref     TEXT,                -- referência / chave no storage
  natureza_operacao   TEXT DEFAULT 'Venda de Mercadorias',
  cfop_venda_dentro   TEXT DEFAULT '5102',
  cfop_venda_fora     TEXT DEFAULT '6102',
  cfop_compra         TEXT DEFAULT '1102',
  crt                 TEXT DEFAULT '1',   -- Código Regime Tributário (NF-e)
  observacoes         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE empresa_config_fiscal DISABLE ROW LEVEL SECURITY;

INSERT INTO empresa_config_fiscal (empresa_id)
VALUES ('a1000000-0000-0000-0000-000000000001'::uuid)
ON CONFLICT (empresa_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────
--  5. EMPRESA_CONFIG_COMERCIAL
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresa_config_comercial (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                UUID NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE CASCADE,
  limite_desconto           NUMERIC(5,2) NOT NULL DEFAULT 10,
  margem_minima             NUMERIC(5,2) NOT NULL DEFAULT 0,
  permite_venda_sem_cliente BOOLEAN NOT NULL DEFAULT true,
  permite_estoque_negativo  BOOLEAN NOT NULL DEFAULT false,
  permite_fiado             BOOLEAN NOT NULL DEFAULT false,
  permite_credito           BOOLEAN NOT NULL DEFAULT true,
  tipo_recibo_padrao        TEXT DEFAULT 'simplificado',
  texto_orcamento           TEXT,
  texto_pedido              TEXT,
  texto_whatsapp            TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE empresa_config_comercial DISABLE ROW LEVEL SECURITY;

INSERT INTO empresa_config_comercial (empresa_id)
VALUES ('a1000000-0000-0000-0000-000000000001'::uuid)
ON CONFLICT (empresa_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────
--  6. EMPRESA_CONFIG_ESTOQUE
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresa_config_estoque (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                  UUID NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE CASCADE,
  permite_multiplos_depositos BOOLEAN NOT NULL DEFAULT false,
  permite_endereçamento       BOOLEAN NOT NULL DEFAULT false,
  permite_estoque_negativo    BOOLEAN NOT NULL DEFAULT false,
  reservar_em_orcamento       BOOLEAN NOT NULL DEFAULT false,
  reservar_em_pedido          BOOLEAN NOT NULL DEFAULT true,
  baixar_estoque_em           TEXT NOT NULL DEFAULT 'faturamento'
    CHECK (baixar_estoque_em IN ('pedido','faturamento','pagamento','separacao')),
  tipo_custo                  TEXT NOT NULL DEFAULT 'ultimo'
    CHECK (tipo_custo IN ('ultimo','medio','manual')),
  controlar_lote              BOOLEAN NOT NULL DEFAULT false,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE empresa_config_estoque DISABLE ROW LEVEL SECURITY;

INSERT INTO empresa_config_estoque (empresa_id)
VALUES ('a1000000-0000-0000-0000-000000000001'::uuid)
ON CONFLICT (empresa_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────
--  7. EMPRESA_CONFIG_FINANCEIRA
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresa_config_financeira (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                UUID NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE CASCADE,
  controla_contas_pagar     BOOLEAN NOT NULL DEFAULT true,
  controla_contas_receber   BOOLEAN NOT NULL DEFAULT true,
  permite_contas_compartilhadas BOOLEAN NOT NULL DEFAULT false,
  plano_contas_proprio      BOOLEAN NOT NULL DEFAULT false,
  pix_chave                 TEXT,
  pix_tipo                  TEXT CHECK (pix_tipo IN ('cpf','cnpj','email','celular','aleatoria')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE empresa_config_financeira DISABLE ROW LEVEL SECURITY;

INSERT INTO empresa_config_financeira (empresa_id)
VALUES ('a1000000-0000-0000-0000-000000000001'::uuid)
ON CONFLICT (empresa_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────
--  8. EMPRESA_COMPARTILHAMENTO_DADOS
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresa_compartilhamento_dados (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                UUID NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE CASCADE,
  grupo_id                  UUID REFERENCES grupos_empresariais(id),
  compartilhar_produtos     BOOLEAN NOT NULL DEFAULT false,
  compartilhar_clientes     BOOLEAN NOT NULL DEFAULT false,
  compartilhar_fornecedores BOOLEAN NOT NULL DEFAULT false,
  compartilhar_marcas       BOOLEAN NOT NULL DEFAULT false,
  compartilhar_categorias   BOOLEAN NOT NULL DEFAULT false,
  compartilhar_tabelas_preco BOOLEAN NOT NULL DEFAULT false,
  compartilhar_anuncios     BOOLEAN NOT NULL DEFAULT false,
  compartilhar_historico    BOOLEAN NOT NULL DEFAULT false,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE empresa_compartilhamento_dados DISABLE ROW LEVEL SECURITY;

INSERT INTO empresa_compartilhamento_dados (empresa_id, grupo_id)
VALUES (
  'a1000000-0000-0000-0000-000000000001'::uuid,
  'c0000000-0000-0000-0000-000000000001'::uuid
)
ON CONFLICT (empresa_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────
--  9. USUARIO_EMPRESAS — acesso multi-empresa por usuário
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuario_empresas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  perfil          TEXT NOT NULL DEFAULT 'operador'
    CHECK (perfil IN ('admin','gerente','operador','financeiro','estoque','leitura')),
  empresa_padrao  BOOLEAN NOT NULL DEFAULT false,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, empresa_id)
);

ALTER TABLE usuario_empresas DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────
-- 10. EMPRESA_AUDITORIA — histórico de alterações
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresa_auditoria (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id      UUID REFERENCES auth.users(id),
  usuario_nome    TEXT,
  acao            TEXT NOT NULL, -- 'criacao', 'edicao_cadastral', 'edicao_fiscal', etc.
  tabela          TEXT,
  campo           TEXT,
  valor_anterior  JSONB,
  valor_novo      JSONB,
  ip              TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE empresa_auditoria DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────
-- 11. ATUALIZAR PROFILES — adicionar tenant_id
-- ─────────────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS tenant_id  UUID REFERENCES tenants(id),
  ADD COLUMN IF NOT EXISTS grupo_id   UUID REFERENCES grupos_empresariais(id);

UPDATE profiles
SET
  tenant_id = 'b0000000-0000-0000-0000-000000000001',
  grupo_id  = 'c0000000-0000-0000-0000-000000000001'
WHERE empresa_id = 'a1000000-0000-0000-0000-000000000001'::uuid;

-- ─────────────────────────────────────────────────────────
-- 12. ÍNDICES DE PERFORMANCE
-- ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_empresas_tenant   ON empresas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_empresas_grupo    ON empresas(grupo_id);
CREATE INDEX IF NOT EXISTS idx_empresas_status   ON empresas(status);
CREATE INDEX IF NOT EXISTS idx_grupos_tenant     ON grupos_empresariais(tenant_id);
CREATE INDEX IF NOT EXISTS idx_usuario_empresas_user ON usuario_empresas(user_id);
CREATE INDEX IF NOT EXISTS idx_empresa_auditoria_emp ON empresa_auditoria(empresa_id);
CREATE INDEX IF NOT EXISTS idx_empresa_auditoria_ts  ON empresa_auditoria(created_at DESC);
