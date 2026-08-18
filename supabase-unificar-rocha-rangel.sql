-- ============================================================
-- UNIFICAR CLIENTE DUPLICADO: ESCRITORIO CONTABILIDADE ROCHA RANGEL
--
-- Dois cadastros do mesmo cliente na empresa Bazar Eficaz:
--   VENCEDOR  a188415c-5cd1-4c1a-9514-3045e1e8f8d0  (ativo, criado 30/06,
--             42 vendas, 42 contas a receber, 25 msgs whatsapp, 1 recebimento)
--   PERDEDOR  2c73238a-6b8b-46b7-95fa-062e4cf88e2a  (já inativo, criado 07/08
--             — mesma janela do bug de sincronização do PDV externo já
--             corrigido em supabase-corrigir-carteira-e-clientes-duplicados.sql
--             — 10 vendas, 10 contas a receber)
--
-- Mesmo padrão daquele conserto: reponta tudo que aponta para o cadastro
-- perdedor, NUNCA apaga a linha (só mantém inativa), e recalcula os saldos
-- denormalizados a partir da fonte de verdade em vez de somar os campos
-- cacheados — o saldo_credito do perdedor (-880,59) é resto do mesmo bug
-- e não bate com creditos_cliente (0 linhas nos dois cadastros), então
-- somar herdaria um número errado.
-- ============================================================

DO $$
DECLARE
  vencedor_id UUID := 'a188415c-5cd1-4c1a-9514-3045e1e8f8d0';
  perdedor_id UUID := '2c73238a-6b8b-46b7-95fa-062e4cf88e2a';
BEGIN

  -- Reponta tudo que referencia o cadastro perdedor. Lista de tabelas
  -- conferida contra o schema atual (mais ampla que a do conserto de
  -- 07/08 — algumas destas tabelas nasceram depois daquele script).
  UPDATE vendas SET cliente_id = vencedor_id WHERE cliente_id = perdedor_id;
  UPDATE contas_receber SET cliente_id = vencedor_id WHERE cliente_id = perdedor_id;
  UPDATE recebimentos SET cliente_id = vencedor_id WHERE cliente_id = perdedor_id;
  UPDATE orcamentos SET cliente_id = vencedor_id WHERE cliente_id = perdedor_id;
  UPDATE automacoes SET cliente_id = vencedor_id WHERE cliente_id = perdedor_id;
  UPDATE creditos_cliente SET cliente_id = vencedor_id WHERE cliente_id = perdedor_id;
  UPDATE credito_utilizacoes SET cliente_id = vencedor_id WHERE cliente_id = perdedor_id;
  UPDATE cobranca_historico SET cliente_id = vencedor_id WHERE cliente_id = perdedor_id;
  UPDATE renegociacoes SET cliente_id = vencedor_id WHERE cliente_id = perdedor_id;
  UPDATE whatsapp_mensagens SET cliente_id = vencedor_id WHERE cliente_id = perdedor_id;

  -- O perdedor já estava inativo; garante e deixa rastro de que foi unificado.
  UPDATE clientes SET
    ativo = false,
    observacoes_financeiras = trim(both E'\n' FROM
      COALESCE(observacoes_financeiras, '') || E'\nUnificado em ' || vencedor_id::text || ' em ' || now()::date),
    updated_at = now()
  WHERE id = perdedor_id;

  -- Recalcula os saldos do vencedor a partir da fonte de verdade — não soma
  -- os dois caches, que é exatamente como o saldo_credito do perdedor ficou
  -- errado (mesmo raciocínio da ETAPA 3 do conserto de 07/08).
  UPDATE clientes c SET
    saldo_devedor = COALESCE((
      SELECT sum(cr.valor_original - COALESCE(cr.valor_recebido, 0))
      FROM contas_receber cr
      WHERE cr.cliente_id = c.id AND cr.status IN ('aberto', 'vencido')
    ), 0),
    saldo_credito = COALESCE((
      SELECT sum(cc.saldo_disponivel)
      FROM creditos_cliente cc
      WHERE cc.cliente_id = c.id AND cc.status IN ('disponivel', 'parcial')
    ), 0),
    updated_at = now()
  WHERE c.id = vencedor_id;

END $$;

-- ── Conferência ──────────────────────────────────────────────
-- Deve mostrar 0 linhas ainda presas ao perdedor.
SELECT 'vendas' AS tabela, count(*) FROM vendas WHERE cliente_id = '2c73238a-6b8b-46b7-95fa-062e4cf88e2a'
UNION ALL SELECT 'contas_receber', count(*) FROM contas_receber WHERE cliente_id = '2c73238a-6b8b-46b7-95fa-062e4cf88e2a'
UNION ALL SELECT 'recebimentos', count(*) FROM recebimentos WHERE cliente_id = '2c73238a-6b8b-46b7-95fa-062e4cf88e2a';

-- Estado final do vencedor
SELECT id, nome, ativo, saldo_devedor, saldo_credito FROM clientes
WHERE id IN ('a188415c-5cd1-4c1a-9514-3045e1e8f8d0', '2c73238a-6b8b-46b7-95fa-062e4cf88e2a');
