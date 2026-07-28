-- ============================================================
-- Parcerias entre Empresas — Fase 1 (produtos vinculados/sincronizados)
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- Parceria entre duas empresas do MESMO tenant (nunca entre clientes
-- diferentes da plataforma). Ativar/desativar é direto pelo admin — as
-- empresas pertencem ao mesmo dono, não há fluxo de convite/aceite entre
-- partes desconhecidas.
CREATE TABLE IF NOT EXISTS empresa_parcerias (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empresa_id_a   UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  empresa_id_b   UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'ativa',  -- 'ativa' | 'inativa'
  criado_por     UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (empresa_id_a <> empresa_id_b)
);
ALTER TABLE empresa_parcerias DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_parcerias_empresa_a ON empresa_parcerias(empresa_id_a);
CREATE INDEX IF NOT EXISTS idx_parcerias_empresa_b ON empresa_parcerias(empresa_id_b);
CREATE INDEX IF NOT EXISTS idx_parcerias_tenant ON empresa_parcerias(tenant_id);

-- Vínculo entre a linha de produto de uma empresa e a linha correspondente
-- na empresa parceira — não é a mesma linha do banco (cada empresa mantém
-- seu próprio cadastro, todas as ~50 telas existentes continuam iguais),
-- é um vínculo que a aplicação usa pra propagar campos de identidade
-- (nome/descrição/categoria/marca/EAN) de um lado pro outro. Estoque e
-- preço nunca propagam — ficam sempre por empresa.
CREATE TABLE IF NOT EXISTS produto_vinculos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parceria_id    UUID NOT NULL REFERENCES empresa_parcerias(id) ON DELETE CASCADE,
  produto_id_a   UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  produto_id_b   UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  metodo         TEXT NOT NULL DEFAULT 'manual',  -- manual | automatico_sku | automatico_ean
  criado_por     UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parceria_id, produto_id_a),
  UNIQUE (parceria_id, produto_id_b)
);
ALTER TABLE produto_vinculos DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_vinculos_produto_a ON produto_vinculos(produto_id_a);
CREATE INDEX IF NOT EXISTS idx_vinculos_produto_b ON produto_vinculos(produto_id_b);
