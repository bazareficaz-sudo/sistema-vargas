-- ═══════════════════════════════════════════════════════════════════════
--  USUÁRIOS, PAPÉIS E PERMISSÕES — Fase 1 (papéis fixos)
--  Criação: 2026-07-26
--  Objetivo: permitir convidar um segundo usuário pra uma empresa já
--  existente, com papel fixo validado no servidor (não só na tela), e
--  proteger a tabela profiles com RLS de verdade (hoje desligada).
-- ═══════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────
--  1. Novos papéis + campos de cadastro do usuário
-- ─────────────────────────────────────────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'gerente', 'financeiro', 'estoque', 'vendas', 'leitura'));

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS telefone            TEXT,
  ADD COLUMN IF NOT EXISTS cargo               TEXT,
  ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo', 'inativo', 'bloqueado', 'convite_pendente')),
  ADD COLUMN IF NOT EXISTS avatar_url          TEXT,
  ADD COLUMN IF NOT EXISTS data_termino_acesso DATE,
  ADD COLUMN IF NOT EXISTS observacoes         TEXT,
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ DEFAULT now();

-- ─────────────────────────────────────────────────────────
--  2. RLS em profiles — hoje estava desligada. Função security definer
--  pra evitar recursão (a policy de SELECT precisa saber a empresa do
--  usuário logado consultando a própria tabela profiles).
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION minha_empresa_id()
RETURNS UUID LANGUAGE SQL SECURITY DEFINER AS $$
  SELECT empresa_id FROM profiles WHERE id = auth.uid();
$$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (
  id = auth.uid() OR empresa_id = minha_empresa_id() OR is_system_admin()
);

-- Update só da própria linha (troca de senha/status obrigatória etc). Mudar
-- papel/status/empresa de OUTRO usuário sempre passa pela rota de servidor
-- com a service-role key (que ignora RLS) e valida gerenciar_usuarios lá —
-- nunca por escrita direta do navegador.
DROP POLICY IF EXISTS "profiles_update_self" ON profiles;
CREATE POLICY "profiles_update_self" ON profiles FOR UPDATE USING (
  id = auth.uid() OR is_system_admin()
);

-- Sem policy de INSERT/DELETE — bloqueado por padrão. Só o provisionamento
-- de empresa nova e o convite de usuário criam linha, ambos via service-role.
