-- Preço por quantidade (atacado) no cadastro do produto.
--
-- Até aqui o produto tinha um preço normal e um promocional, os dois por
-- unidade. Quem leva 12 pagava o mesmo por unidade de quem leva 1, e o
-- desconto de volume era feito à mão no PDV, item a item.
--
-- Guardado como JSONB e não em tabela própria porque são no máximo três
-- faixas por produto, sempre lidas junto com o produto e nunca consultadas
-- isoladamente — uma tabela filha custaria um join em toda tela que mostra
-- preço (PDV, orçamento, etiqueta) sem nada em troca.
--
-- Formato:
--   [{"qtd": 3, "preco": 275.00}, {"qtd": 6, "preco": 265.00}, {"qtd": 12, "preco": 250.00}]
--
-- `qtd` é a quantidade MÍNIMA para o preço valer, e a faixa aplicada é a de
-- maior `qtd` que couber na quantidade vendida. O markup de cada faixa NÃO é
-- gravado: ele é calculado a partir do custo atual na hora de exibir, senão
-- ficaria mentindo assim que o custo do produto mudasse.

ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS precos_quantidade JSONB;

COMMENT ON COLUMN produtos.precos_quantidade IS
  'Faixas de preço por quantidade: [{"qtd": N, "preco": V}], no máximo 3, ordenadas por qtd. Vale a faixa de maior qtd que couber na quantidade vendida.';
