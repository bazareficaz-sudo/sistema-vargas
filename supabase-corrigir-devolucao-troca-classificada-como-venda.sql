-- ============================================================
-- DEVOLUÇÃO DENTRO DE TROCA — classificada como venda, não devolução
--
-- Medido em 18/09/2026, achado a partir de uma reclamação sobre o SKU 4814
-- (venda #302567): quando o PDV externo processa uma TROCA (devolve um
-- item, leva outro no lugar, tudo na mesma venda), o item devolvido entra em
-- `venda_itens` com quantidade negativa — mas com `tipo = 'venda'` (o
-- default da coluna), quando deveria ser `tipo = 'devolucao'`.
--
-- O ESTOQUE em si está correto — `produtos.estoque` e `estoque_movimentacoes`
-- já tratam a quantidade negativa certo, o saldo é creditado de volta. O
-- problema é só de CLASSIFICAÇÃO/RELATÓRIO:
--   - a linha não aparece na aba "Devoluções" do Estoque Detalhado;
--   - aparece disfarçada de venda normal na movimentação do produto;
--   - `vendas.tem_devolucao` fica false, escondendo a troca de qualquer
--     relatório que dependa desse campo.
--
-- Medido: 53 itens em 46 vendas, desde 31/07/2026, R$ 1.282,22 em mercadoria
-- devolvida mal classificada. Conferido antes de corrigir: nenhuma das 46
-- vendas já tinha `tem_devolucao=true` nem item com tipo='devolucao' — a
-- correção não sobrescreve nada que já estivesse certo.
--
-- Isto é só o dado histórico. A causa (o PDV externo grava tipo errado na
-- troca) mora em outro repositório (vargasnexus-pdv) e é corrigida à parte.
-- ============================================================

-- 1. Reclassifica os itens negativos gravados como 'venda'.
UPDATE venda_itens
SET tipo = 'devolucao'
WHERE quantidade < 0 AND tipo = 'venda';

-- 2. Marca a venda-pai como tendo devolução, com o valor certo — só nas
--    vendas afetadas (as que ganharam item reclassificado no passo 1).
UPDATE vendas v
SET tem_devolucao = true,
    total_devolucoes = COALESCE((
      SELECT sum(abs(vi.total))
      FROM venda_itens vi
      WHERE vi.venda_id = v.id::text AND vi.tipo = 'devolucao'
    ), 0)
WHERE v.id::text IN (
  SELECT DISTINCT venda_id FROM venda_itens WHERE tipo = 'devolucao'
)
AND v.tem_devolucao = false;

-- ── Conferência ──────────────────────────────────────────────
--   -- deve devolver 0:
--   SELECT count(*) FROM venda_itens WHERE quantidade < 0 AND tipo = 'venda';
--
--   -- deve devolver a venda #302567 com tem_devolucao=true e total_devolucoes=9.50:
--   SELECT numero, tem_devolucao, total_devolucoes FROM vendas WHERE numero = 302567;
