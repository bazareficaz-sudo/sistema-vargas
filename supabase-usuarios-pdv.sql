-- ============================================================
-- USUARIOS_PDV — operadores do terminal VargasNexus PDV
-- Execute no Supabase Dashboard → SQL Editor
-- Tabela já existe em produção; este arquivo documenta o schema
-- (idempotente) e adiciona a coluna nova usada pelo módulo
-- "Usuários do PDV" do dashboard.
-- ============================================================

CREATE TABLE IF NOT EXISTS usuarios_pdv (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            UUID NOT NULL,
  empresa_nome          TEXT,
  empresa_fiscal_id     UUID,
  empresa_fiscal_nome   TEXT,
  empresa_estoque_id    UUID,
  empresa_estoque_nome  TEXT,
  deposito_id           UUID,
  deposito_nome         TEXT,
  login                 TEXT NOT NULL,
  senha_hash            TEXT NOT NULL,
  nome                  TEXT NOT NULL,
  cargo                 TEXT DEFAULT 'Operador',
  unificar_estoque      BOOLEAN DEFAULT false,
  permissoes            JSONB DEFAULT '{}'::jsonb,
  ativo                 BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE usuarios_pdv ADD COLUMN IF NOT EXISTS limite_desconto NUMERIC(5,2) DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_pdv_login ON usuarios_pdv(login);
CREATE INDEX IF NOT EXISTS idx_usuarios_pdv_empresa ON usuarios_pdv(empresa_id);

ALTER TABLE usuarios_pdv DISABLE ROW LEVEL SECURITY;
