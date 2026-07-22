-- ============================================================
-- Saúde da venda retroativa (custo por item) + canal de origem
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- Custo do produto no momento da venda — antes só existia no carrinho em
-- memória durante o PDV e era descartado; sem isso não dá pra recalcular a
-- margem/saúde de uma venda depois de fechada.
ALTER TABLE venda_itens ADD COLUMN IF NOT EXISTS custo_unitario NUMERIC(10,2);

-- Canal de origem da venda. Hoje só existe um caminho real (PDV), mas a
-- coluna já fica pronta pra quando existirem outras origens.
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS canal TEXT DEFAULT 'PDV';
