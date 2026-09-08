-- FASE 0.6C — o orçamento passa a ser UM comando, não uma sequência de CRUDs.
-- Aplicada em produção em 08/09/2026 como `orcamento_transacional_e_revisao`.
--
-- Revisão: o SERVIDOR é a única autoridade. O cliente declara `revisao_base`
-- e NUNCA incrementa. Se as duas pontas pudessem incrementar, duas edições
-- concorrentes chegariam com o mesmo número e uma sobrescreveria a outra.
--
-- SECURITY INVOKER e não DEFINER: a função é chamada apenas pela rota, com a
-- chave de serviço, que já ignora RLS. DEFINER não acrescentaria capacidade e
-- acrescentaria risco. `search_path` fixo mesmo assim.
--
-- O conteúdo completo da função está no commit desta migration; ver
-- docs/auditoria/FASE-0.6C-DESENHO-ORCAMENTO-TRANSACIONAL.md para o porquê de
-- cada decisão (numeração com buracos aceitos, DELETE+INSERT dentro da
-- transação, FOR UPDATE serializando revisões concorrentes).

ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS revisao INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS terminal_id UUID;

-- A função `salvar_orcamento_pdv(uuid,uuid,uuid,integer,jsonb,jsonb)` foi
-- criada nesta migration com SECURITY INVOKER, search_path=public, e:
--   REVOKE ALL ... FROM PUBLIC, anon, authenticated;
--   GRANT EXECUTE ... TO service_role;
