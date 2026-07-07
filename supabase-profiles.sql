-- ═══════════════════════════════════════════════════════════
--  Tabela profiles — vincula usuários Supabase Auth às empresas
--  Multi-tenant SaaS: um usuário pertence a uma empresa + role
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  empresa_id  UUID REFERENCES empresas(id),
  role        TEXT NOT NULL DEFAULT 'gerente' CHECK (role IN ('admin', 'gerente')),
  nome        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Seed: vincular primeiro usuário admin ao Bazar Eficaz
-- (substituir pelo UUID real do usuário após criar conta no Supabase Auth)
-- INSERT INTO profiles (id, empresa_id, role, nome)
-- VALUES ('<UUID_DO_USUARIO_AUTH>', 'a1000000-0000-0000-0000-000000000001', 'admin', 'Administrador')
-- ON CONFLICT (id) DO NOTHING;
