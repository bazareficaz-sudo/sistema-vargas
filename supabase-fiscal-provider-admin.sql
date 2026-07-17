-- Qual provedor fiscal novas empresas usam por padrao ao se cadastrar, e
-- qualquer override por empresa fica em nfe_config.provider (ja existe,
-- ver supabase-fiscal-provider.sql). Decisao do administrador do sistema,
-- nao do cliente/assinante — mesmo principio de sistema_integracoes
-- (supabase-integracoes.sql): preenchido pelo admin, nao pelos assinantes.

CREATE TABLE IF NOT EXISTS sistema_config_fiscal (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_padrao TEXT NOT NULL DEFAULT 'focusnfe',
  updated_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE sistema_config_fiscal DISABLE ROW LEVEL SECURITY;

-- Singleton: garante que só existe uma linha de configuração.
INSERT INTO sistema_config_fiscal (provider_padrao)
SELECT 'focusnfe'
WHERE NOT EXISTS (SELECT 1 FROM sistema_config_fiscal);
