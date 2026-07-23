-- ============================================================
-- Token de conta (nível plataforma) da Brasil NFe — distinto do token
-- por empresa em nfe_config.credenciais. Necessário pra cadastrar uma
-- empresa nova via API (POST /services/empresa/AdicionarEmpresa), que
-- devolve o token específico daquela empresa a ser usado depois.
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE sistema_config_fiscal ADD COLUMN IF NOT EXISTS brasilnfe_user_token TEXT;
