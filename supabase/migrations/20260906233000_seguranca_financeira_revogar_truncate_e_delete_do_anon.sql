-- FASE 0.5 — SEGURANÇA FINANCEIRA, PASSO 1: o que é provadamente seguro.
--
-- Esta migration NÃO liga RLS em tabela nenhuma. O motivo está medido: nas
-- 24h anteriores a ela, 99 das 104 vendas entraram pelo papel `anon` SEM
-- usuário autenticado, junto com 98 inserts em `venda_itens`, 23 em
-- `recebimentos` e 23 updates em `contas_receber`. É o PDV externo
-- (vargasnexus-pdv), que conecta com a chave anônima e autentica o operador
-- por RPC (`autenticar_operador_pdv`, SECURITY DEFINER) sem nunca virar um
-- usuário do Supabase. Ligar RLS nessas quatro tabelas pararia o balcão.
--
-- Entra aqui só o que não pode ter dependência:
--
--   TRUNCATE — o PostgREST não expõe TRUNCATE. Não há verbo REST que o
--   produza. É resíduo do GRANT padrão do Postgres; nenhum caminho de
--   produção pode depender dele. Risco nulo por construção, não por medição.
--
--   DELETE nas tabelas financeiras — zero DELETEs do `anon` em 24h de log, e
--   há precedente direto: a Onda 2 (30/08/2026) já revogou DELETE de
--   `vendas` e `venda_itens` e o PDV externo continuou vendendo.
--
-- FICAM DE FORA, de propósito: INSERT e UPDATE do `anon`, que são usados e
-- medidos. Revogá-los antes de o PDV externo autenticar quebraria a venda.
--
-- COMO DESFAZER:  GRANT TRUNCATE, DELETE ON <tabela> TO anon;

REVOKE TRUNCATE ON TABLE
  vendas, venda_itens, contas_receber, contas_pagar, recebimentos,
  creditos_cliente, credito_utilizacoes, renegociacoes, cr_auditoria,
  clientes, empresa_auditoria
FROM anon, authenticated;

REVOKE DELETE ON TABLE
  contas_pagar, recebimentos, creditos_cliente, credito_utilizacoes,
  renegociacoes, cr_auditoria, contas_receber
FROM anon;

-- Auditoria não se apaga, nem por usuário autenticado.
REVOKE DELETE ON TABLE empresa_auditoria, cr_auditoria FROM anon, authenticated;
