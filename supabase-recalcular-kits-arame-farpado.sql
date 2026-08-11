-- Recalcula o estoque/custo dos kits que usam "ARAME FARPADO - 50MT" (sku
-- 3914) a partir do estoque atual do componente (15un) — mesma fórmula de
-- calcularKit()/recalcularKitsQueUsam() em src/lib/produtos/kit.ts.
-- "2 peças" e "3 peças" estavam travados em 0 porque o estoque do
-- componente só mudou por um caminho (entrada manual/ajuste) que hoje não
-- dispara o recálculo automático do kit.

WITH componente AS (
  SELECT id, preco_custo, estoque
  FROM produtos
  WHERE id = '740fcdd2-d085-4cc4-a2c4-fa039b09311b' -- ARAME FARPADO - 50MT (sku 3914)
),
kits_afetados AS (
  SELECT ki.kit_id, ki.quantidade, ki.controla_estoque
  FROM kit_itens ki
  WHERE ki.produto_id = (SELECT id FROM componente)
)
UPDATE produtos p
SET
  preco_custo = (SELECT preco_custo FROM componente) * k.quantidade,
  estoque = CASE
    WHEN k.controla_estoque = false THEN p.estoque -- não controla estoque, mantém como está
    ELSE GREATEST(0, FLOOR((SELECT estoque FROM componente) / k.quantidade))
  END,
  updated_at = now()
FROM kits_afetados k
WHERE p.id = k.kit_id;
