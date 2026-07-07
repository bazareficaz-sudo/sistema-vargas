-- Configurações globais do sistema (credenciais de app por plataforma)
-- Preenchido pelo administrador do sistema, não pelos assinantes
CREATE TABLE IF NOT EXISTS sistema_integracoes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plataforma  TEXT NOT NULL UNIQUE,  -- shopee | mercadolivre | amazon | magalu
  partner_id  TEXT,
  partner_key TEXT,
  app_id      TEXT,
  app_secret  TEXT,
  extra       JSONB,  -- campos adicionais por plataforma
  ativo       BOOLEAN DEFAULT true,
  updated_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE sistema_integracoes DISABLE ROW LEVEL SECURITY;
