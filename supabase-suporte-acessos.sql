-- ═══════════════════════════════════════════════════════════════════════
--  ACESSO DE SUPORTE — impersonação temporária e auditada
--  Criação: 2026-07-26
--  Objetivo: permitir que o dono da plataforma (system admin) assuma uma
--  sessão real e temporária como o admin de uma empresa cliente, pra dar
--  suporte de configuração via ticket, sem precisar de senha do cliente e
--  sem reconstruir a arquitetura de "empresa ativa" do sistema inteiro.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS suporte_acessos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id         UUID NOT NULL REFERENCES auth.users(id),
  empresa_id       UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_alvo_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  motivo           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'encerrada', 'expirada')),
  iniciado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em        TIMESTAMPTZ NOT NULL,
  encerrado_em     TIMESTAMPTZ
);

ALTER TABLE suporte_acessos ENABLE ROW LEVEL SECURITY;

-- Leitura/atualização liberada pra própria sessão (o banner e o botão
-- "Encerrar suporte" rodam com o client autenticado como o usuário-alvo,
-- que durante a janela de suporte é justamente quem está impersonando) e
-- pro system admin (pra listar/encerrar à distância).
DROP POLICY IF EXISTS "suporte_acessos_select" ON suporte_acessos;
CREATE POLICY "suporte_acessos_select" ON suporte_acessos FOR SELECT USING (
  usuario_alvo_id = auth.uid() OR is_system_admin()
);

DROP POLICY IF EXISTS "suporte_acessos_update" ON suporte_acessos;
CREATE POLICY "suporte_acessos_update" ON suporte_acessos FOR UPDATE USING (
  usuario_alvo_id = auth.uid() OR is_system_admin()
);

-- Sem policy de INSERT/DELETE — só a rota de servidor (service role) cria
-- linha, depois de validar que quem chamou é system admin.

CREATE INDEX IF NOT EXISTS idx_suporte_acessos_alvo ON suporte_acessos(usuario_alvo_id, status);
CREATE INDEX IF NOT EXISTS idx_suporte_acessos_empresa ON suporte_acessos(empresa_id);
