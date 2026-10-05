-- Acerta os kits que JÁ estão com estoque e custo errados.
--
-- Os gatilhos de supabase-kit-custo-trigger.sql só olham para frente: kit que
-- já estava errado continua errado até um componente se mexer. Este arquivo
-- corrige o passado. Rode DEPOIS de supabase-kit-custo-trigger.sql.
--
-- Medido em 05/10/2026 (Bazar Eficaz): 256 kits com composição, 13 com
-- estoque errado e 58 com custo errado.
--
-- ── ESTOQUE ─────────────────────────────────────────────────────────────
-- Mesma conta e mesmo critério da migração de 27/08 (estoque_do_kit()): vale
-- para todos os kits com composição.
--
-- ATENÇÃO — kit que foi VENDIDO no PDV: o PDV baixa o estoque do próprio kit
-- e não o dos componentes, por isso aparecem kits com saldo negativo (-1, -7).
-- Recalcular devolve o saldo ao que os componentes permitem montar, o que é
-- certo para a tela, mas a venda do kit nunca abateu as peças. Se for
-- relevante, uma contagem física dos componentes dessas vendas resolve.

UPDATE produtos k
   SET estoque = estoque_do_kit(k.id)
 WHERE k.tipo = 'kit'
   AND EXISTS (SELECT 1 FROM kit_itens ki WHERE ki.kit_id = k.id)
   AND k.estoque IS DISTINCT FROM estoque_do_kit(k.id);

-- ── CUSTO ───────────────────────────────────────────────────────────────
-- Só onde a conta é confiável (custo_do_kit() não nulo: nenhum componente
-- sem custo, nenhuma quantidade absurda) E todo componente custa a partir de
-- R$ 1,00. O segundo critério existe porque produtos.preco_custo tem 2 casas
-- decimais: num kit de "100 buchas a R$ 0,04" o erro de arredondamento do
-- custo unitário vira erro grande no pacote — e o custo do pacote vem da
-- nota, não da soma. Esses ficam de fora, na lista abaixo.
--
-- Medido: 49 kits corrigidos, 8 para revisar, 1 composição suspeita.

UPDATE produtos k
   SET preco_custo = custo_do_kit(k.id)
 WHERE k.tipo = 'kit'
   AND custo_do_kit(k.id) IS NOT NULL
   AND k.preco_custo IS DISTINCT FROM custo_do_kit(k.id)
   AND NOT EXISTS (
     SELECT 1 FROM kit_itens ki
       JOIN produtos c ON c.id = ki.produto_id
      WHERE ki.kit_id = k.id AND c.preco_custo < 1.00
   );

-- ── PARA REVISAR À MÃO (só consulta, não altera nada) ───────────────────
-- Kits cujo custo gravado difere da soma dos componentes e que o acerto acima
-- NÃO tocou: pacote de peça barata (custo unitário com pouca precisão) e
-- composição com quantidade suspeita ou componente sem custo.

SELECT k.sku, k.nome, k.preco_custo AS custo_gravado,
       ROUND(SUM(c.preco_custo * ki.quantidade), 2) AS soma_dos_componentes,
       MIN(ki.quantidade) AS menor_quantidade,
       CASE WHEN custo_do_kit(k.id) IS NULL THEN 'composição suspeita ou componente sem custo'
            ELSE 'componente de custo baixo (menos de R$ 1,00) — conferir com a nota' END AS motivo
  FROM produtos k
  JOIN kit_itens ki ON ki.kit_id = k.id
  LEFT JOIN produtos c ON c.id = ki.produto_id
 WHERE k.tipo = 'kit' AND k.ativo
 GROUP BY k.id, k.sku, k.nome, k.preco_custo
HAVING ABS(COALESCE(k.preco_custo, 0) - COALESCE(SUM(c.preco_custo * ki.quantidade), 0)) > 0.005
 ORDER BY motivo, k.sku;
