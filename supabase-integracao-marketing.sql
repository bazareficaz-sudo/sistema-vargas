-- ============================================================
-- Integração com o Vargas Marketing (contrato v1) — tokens de acesso.
-- Execute no Supabase Dashboard → SQL Editor ANTES do deploy.
--
-- Aditivo: uma tabela nova. Nenhum ALTER/DROP em tabela existente.
--
-- O Vargas Marketing é outro sistema (outro banco). Ele NÃO recebe chave do
-- Supabase do ERP: recebe um token de integração, gerado aqui, que só dá
-- leitura do catálogo marcado com a tag "marketing" da empresa do token.
-- O banco guarda só o SHA-256; o valor em claro aparece uma vez na tela.
-- ============================================================

CREATE TABLE IF NOT EXISTS integracao_marketing_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,
  token_prefixo   TEXT NOT NULL,
  expira_em       TIMESTAMPTZ NOT NULL,
  ultimo_uso_em   TIMESTAMPTZ,
  total_chamadas  INTEGER NOT NULL DEFAULT 0,
  revogado_em     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integracao_marketing_tokens_empresa ON integracao_marketing_tokens(empresa_id);

ALTER TABLE integracao_marketing_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON integracao_marketing_tokens FROM anon;

-- Criação, revogação e validação passam por rota de servidor (chave de
-- serviço + checagem de permissão). Pelo navegador, só leitura dos tokens
-- da própria empresa, e sem o hash.
DROP POLICY IF EXISTS "integracao_marketing_tokens_leitura" ON integracao_marketing_tokens;
CREATE POLICY "integracao_marketing_tokens_leitura" ON integracao_marketing_tokens
  FOR SELECT TO authenticated
  USING (empresa_id IN (SELECT empresa_id FROM profiles WHERE id = auth.uid()));
REVOKE ALL ON integracao_marketing_tokens FROM authenticated;
GRANT SELECT (id, empresa_id, nome, token_prefixo, expira_em, ultimo_uso_em, total_chamadas, revogado_em, created_at)
  ON integracao_marketing_tokens TO authenticated;
