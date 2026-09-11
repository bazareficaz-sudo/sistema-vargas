-- FASE 0.6C.6A — proteger a coluna de arbitragem.
-- Aplicada em produção em 11/09/2026.
--
-- ── O DEFEITO QUE ISTO FECHA ────────────────────────────────────────────
--
-- `orcamentos.venda_id` é a única fonte de verdade de qual venda converteu
-- qual orçamento, e a RPC `converter_orcamento_pdv` arbitra nela com
-- compare-and-set. Mas `anon` tinha UPDATE na TABELA inteira, então qualquer
-- cliente com a chave pública podia gravar `venda_id` direto pelo PostgREST,
-- sem passar pela RPC, sem revisão e sem arbitragem.
--
-- Medido: `PATCH /rest/v1/orcamentos?id=eq.<real>` com a chave anon devolveu
-- 204 e gravou. A garantia era de convenção, não de permissão.
--
-- ── POR QUE NÃO BASTA REVOGAR A COLUNA ──────────────────────────────────
--
-- No Postgres, privilégio de UPDATE na TABELA cobre todas as colunas, e um
-- REVOKE por coluna NÃO subtrai dele. Provado neste banco, em transação
-- revertida:
--
--   antes ................................. tabela=true  venda_id=true
--   após REVOKE UPDATE (venda_id) ......... tabela=true  venda_id=TRUE  ← não bloqueou
--   após REVOKE UPDATE ON orcamentos ...... tabela=false venda_id=false
--   após GRANT UPDATE (status) ............ status=true  venda_id=false
--
-- Então: tirar o privilégio da tabela e devolver coluna a coluna.
--
-- ── AS COLUNAS, LEVANTADAS NO CÓDIGO ────────────────────────────────────
--
-- anon (PDV Electron, src/main/api.js):
--   atualizarStatusOrcamento .. status
--   atualizarOrcamento ........ cliente_nome, subtotal, desconto, total,
--                               observacao, validade
--   (payload montado campo a campo, lista fechada — não há spread dinâmico)
--
-- authenticated (web, browser client):
--   OrcamentosClient .......... enviado_em · status, updated_at
--   EditarOrcamentoModal ...... cliente_id, cliente_nome, validade, observacao,
--                               subtotal, desconto, total, updated_at
--   CondicoesOrcamentoModal ... desconto_avista_pct, avista_formas,
--                               parcelas_max, parcelas_sem_juros,
--                               condicoes_observacao, updated_at
--
-- Nenhum caminho escreve: id, empresa_id, numero, operador_nome, created_at,
-- revisao, terminal_id, venda_id.
--
-- Ganho lateral: `revisao` também deixou de ser gravável por anon e
-- authenticated. O UPDATE de tabela cobria essa coluna, e ela é autoridade do
-- servidor desde a 0.6C.
--
-- ── ESCOPO ──────────────────────────────────────────────────────────────
--
-- Só UPDATE. INSERT, SELECT, TRUNCATE, REFERENCES e TRIGGER de `anon` ficam
-- como estão — são dívida separada, registrada, e mexer neles aqui seria
-- ampliar escopo no meio de um gate.

REVOKE UPDATE ON public.orcamentos FROM anon;
REVOKE UPDATE ON public.orcamentos FROM authenticated;

GRANT UPDATE (status, cliente_nome, subtotal, desconto, total, observacao, validade)
   ON public.orcamentos TO anon;

GRANT UPDATE (status, cliente_id, cliente_nome, subtotal, desconto, total,
              observacao, validade, updated_at, enviado_em,
              desconto_avista_pct, avista_formas, parcelas_max,
              parcelas_sem_juros, condicoes_observacao)
   ON public.orcamentos TO authenticated;
