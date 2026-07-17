-- Camada de abstração fiscal (FiscalProvider) — permite trocar de provedor
-- (hoje só Focus NFe funciona de verdade; Brasil NFe fica como stub até
-- termos documentação/credenciais de teste) sem mexer no resto do sistema.

ALTER TABLE nfe_config
  ADD COLUMN IF NOT EXISTS provider     TEXT NOT NULL DEFAULT 'focusnfe',  -- focusnfe | brasilnfe
  ADD COLUMN IF NOT EXISTS credenciais  JSONB NOT NULL DEFAULT '{}'::jsonb;

-- credenciais guarda { token_homologacao, token_producao } daqui pra frente —
-- corrige o gap de hoje, em que o mesmo focusnfe_token era reaproveitado
-- pros dois ambientes (a Focus emite tokens diferentes por ambiente).
-- focusnfe_token continua existindo: se credenciais estiver vazio, o
-- FiscalProvider cai pra esse campo — configuração já feita antes desta
-- migration continua funcionando sem precisar recadastrar o token.
