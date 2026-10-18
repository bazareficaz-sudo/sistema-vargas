-- FECHAMENTO DO CONTADOR — envio por e-mail.
--
-- O .zip do mês (Financeiro › Contabilidade) passa a ir direto para o
-- e-mail do contador cadastrado na empresa (empresas.email_contador), por
-- botão ou sozinho todo mês.
--
-- fechamento_contador_config: liga o envio automático e o dia do mês em que
--   ele sai (o fechamento é sempre do mês anterior), e um e-mail opcional
--   que recebe cópia (o dono, para saber que foi).
-- fechamento_contador_envios: cada envio, com o resultado. É o que a tela
--   mostra ("enviado em 02/11 para ...") e o que impede o automático de
--   mandar o mesmo mês duas vezes.

CREATE TABLE IF NOT EXISTS fechamento_contador_config (
  empresa_id        UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  envio_automatico  BOOLEAN NOT NULL DEFAULT false,
  dia_envio         INT NOT NULL DEFAULT 2 CHECK (dia_envio BETWEEN 1 AND 28),
  copia_para        TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fechamento_contador_envios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  mes            TEXT NOT NULL CHECK (mes ~ '^\d{4}-\d{2}$'),
  para           TEXT NOT NULL,
  copia          TEXT,
  origem         TEXT NOT NULL CHECK (origem IN ('manual', 'automatico')),
  status         TEXT NOT NULL CHECK (status IN ('enviado', 'erro')),
  erro           TEXT,
  notas          INT,
  tamanho_bytes  INT,
  provedor_id    TEXT,
  enviado_por    UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fechamento_envios_empresa_mes
  ON fechamento_contador_envios (empresa_id, mes, created_at DESC);

ALTER TABLE fechamento_contador_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE fechamento_contador_envios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fechamento_config_do_grupo ON fechamento_contador_config;
CREATE POLICY fechamento_config_do_grupo ON fechamento_contador_config
  FOR ALL USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

DROP POLICY IF EXISTS fechamento_envios_do_grupo ON fechamento_contador_envios;
CREATE POLICY fechamento_envios_do_grupo ON fechamento_contador_envios
  FOR ALL USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

REVOKE ALL ON fechamento_contador_config, fechamento_contador_envios FROM anon;
