-- ============================================================
-- VENDEDORES SaaS — MULTI-EMPRESA
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. ESTENDER TABELA EXISTENTE
ALTER TABLE vendedores
  ADD COLUMN IF NOT EXISTS tenant_id              UUID,
  ADD COLUMN IF NOT EXISTS apelido                TEXT,
  ADD COLUMN IF NOT EXISTS cpf                    TEXT,
  ADD COLUMN IF NOT EXISTS rg                     TEXT,
  ADD COLUMN IF NOT EXISTS telefone               TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp               TEXT,
  ADD COLUMN IF NOT EXISTS email                  TEXT,
  ADD COLUMN IF NOT EXISTS data_nascimento        DATE,
  ADD COLUMN IF NOT EXISTS data_admissao          DATE,
  ADD COLUMN IF NOT EXISTS data_desligamento      DATE,
  ADD COLUMN IF NOT EXISTS status                 TEXT DEFAULT 'ativo',
  ADD COLUMN IF NOT EXISTS matricula              TEXT,
  ADD COLUMN IF NOT EXISTS identificador_externo  TEXT,
  ADD COLUMN IF NOT EXISTS participa_comissao     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS tipo_remuneracao       TEXT DEFAULT 'nenhum',
  ADD COLUMN IF NOT EXISTS obs_comissao           TEXT,
  ADD COLUMN IF NOT EXISTS permite_todas_empresas BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS user_id                UUID,
  ADD COLUMN IF NOT EXISTS permite_login          BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS obs                    TEXT,
  ADD COLUMN IF NOT EXISTS created_at             TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by             UUID,
  ADD COLUMN IF NOT EXISTS updated_by             UUID;

-- Sincronizar status com campo ativo legado
UPDATE vendedores
SET
  status     = CASE WHEN ativo THEN 'ativo' ELSE 'inativo' END,
  created_at = COALESCE(created_at, now()),
  updated_at = COALESCE(updated_at, now())
WHERE status IS NULL;

-- 2. VÍNCULO MULTI-EMPRESA
-- vendedor_id UUID para ser compatível com vendedores.id UUID
-- Sem REFERENCES empresas(id) para não depender do módulo SaaS
CREATE TABLE IF NOT EXISTS vendedor_empresas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedor_id       UUID NOT NULL REFERENCES vendedores(id) ON DELETE CASCADE,
  empresa_id        UUID NOT NULL,
  empresa_principal BOOLEAN DEFAULT false,
  pode_vender       BOOLEAN DEFAULT true,
  ativo             BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(vendedor_id, empresa_id)
);
ALTER TABLE vendedor_empresas DISABLE ROW LEVEL SECURITY;

-- Popular vínculo para registros existentes
INSERT INTO vendedor_empresas (vendedor_id, empresa_id, empresa_principal, pode_vender, ativo)
SELECT id, empresa_id, true, true, ativo
FROM vendedores
WHERE empresa_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM vendedor_empresas ve
    WHERE ve.vendedor_id = vendedores.id AND ve.empresa_id = vendedores.empresa_id
  );

-- 3. AUDITORIA
CREATE TABLE IF NOT EXISTS vendedor_auditoria (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedor_id    UUID NOT NULL REFERENCES vendedores(id) ON DELETE CASCADE,
  usuario_id     UUID,
  usuario_nome   TEXT,
  acao           TEXT NOT NULL,
  campo          TEXT,
  valor_anterior JSONB,
  valor_novo     JSONB,
  created_at     TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE vendedor_auditoria DISABLE ROW LEVEL SECURITY;

-- 4. ÍNDICES
CREATE INDEX IF NOT EXISTS idx_vendedores_tenant    ON vendedores(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vendedores_empresa   ON vendedores(empresa_id);
CREATE INDEX IF NOT EXISTS idx_vendedores_status    ON vendedores(status);
CREATE INDEX IF NOT EXISTS idx_vendedores_cpf       ON vendedores(cpf);
CREATE INDEX IF NOT EXISTS idx_vendedores_nome      ON vendedores(nome);
CREATE INDEX IF NOT EXISTS idx_vend_emp_vendedor    ON vendedor_empresas(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_vend_emp_empresa     ON vendedor_empresas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_vend_audit_vendedor  ON vendedor_auditoria(vendedor_id);
