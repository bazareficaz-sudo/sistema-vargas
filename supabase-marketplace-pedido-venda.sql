-- ============================================================
-- Liga um pedido de marketplace à venda criada (sob demanda, só quando
-- o usuário pede pra emitir NF-e) pra emissão fiscal real — reaproveita
-- 100% de emitirNfceParaVenda() já usada por PDV/Vendas/Automações.
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE marketplace_pedidos
  ADD COLUMN IF NOT EXISTS venda_id UUID REFERENCES vendas(id);
