-- ═══════════════════════════════════════════════════════════════════════
--  FIX — atualizar_contas_vencidas()
--  Criação: 2026-07-26
--  A tela de Contas a Pagar (src/app/dashboard/contas-pagar/page.tsx) já
--  chamava essa RPC antes de listar/somar (dentro de um try/catch que
--  engolia o erro em silêncio) — mas a função nunca existiu no banco,
--  então nenhuma conta era promovida de 'pendente' pra 'vencido'
--  automaticamente. Cria a função de verdade.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION atualizar_contas_vencidas()
RETURNS void LANGUAGE sql AS $$
  UPDATE contas_pagar SET status = 'vencido'
  WHERE status = 'pendente' AND vencimento < CURRENT_DATE;
$$;
