-- Encerramento automático da sessão do painel web, por empresa.
--
-- Até aqui os 30 minutos de inatividade e o logout na virada do dia estavam
-- fixos no código (SessaoVigia). Esta tabela deixa o gestor decidir, em
-- Gestão → Sessão e Segurança, se cada um vale e — no caso da inatividade —
-- depois de quanto tempo.
--
-- Mesmo padrão das outras empresa_config_*: uma linha por empresa,
-- empresa_id UNIQUE, isolamento por empresa_id na aplicação. Empresa sem
-- linha usa o padrão do código, que é exatamente o comportamento antigo
-- (inatividade ligada com 30 min, virada do dia ligada).
--
-- Não mexe no PDV Electron, que tem sessão própria.

CREATE TABLE IF NOT EXISTS empresa_config_sessao (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                 UUID NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE CASCADE,

  logout_inatividade_ativo   BOOLEAN NOT NULL DEFAULT true,
  -- 5 min a 12 h. Abaixo de 5 o usuário é derrubado no meio de uma conferência;
  -- acima de 12 h quem quer "nunca" deve desligar a regra, não fingir com 9999.
  logout_inatividade_min     INTEGER NOT NULL DEFAULT 30
    CHECK (logout_inatividade_min BETWEEN 5 AND 720),

  logout_virada_dia_ativo    BOOLEAN NOT NULL DEFAULT true,

  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE empresa_config_sessao DISABLE ROW LEVEL SECURITY;

-- Configuração da casa, editada no painel: nada disso é do terminal, e menos
-- ainda do anônimo (mesma regra da onda 2 de fechamento do anon).
REVOKE ALL ON empresa_config_sessao FROM anon;
