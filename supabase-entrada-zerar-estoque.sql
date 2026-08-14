-- "Zerar o estoque antes da entrada", item a item.
--
-- Para que serve: quando o saldo do sistema não vale mais nada — inventário
-- que ficou para trás, produto que nunca foi controlado, saldo negativo de
-- venda sem entrada — e a nota que está chegando É todo o estoque daquele
-- produto. Sem isso o operador precisa dar a entrada, sair, abrir o cadastro
-- e ajustar cada produto à mão.
--
-- Nas duas telas de entrada. A manual guarda os itens em memória durante a
-- digitação, mas o botão "Salvar Rascunho" grava em `entrada_itens` campo a
-- campo — sem a coluna, quem marcasse os produtos e salvasse o rascunho
-- perderia as marcações em silêncio ao retomar.
--
-- O padrão é `false` de propósito: zerar estoque é destrutivo, e o valor que
-- não foi escolhido tem que ser o que não mexe em nada.

ALTER TABLE nfe_itens
  ADD COLUMN IF NOT EXISTS zerar_estoque_antes BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE entrada_itens
  ADD COLUMN IF NOT EXISTS zerar_estoque_antes BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN nfe_itens.zerar_estoque_antes IS
  'Se true, ao finalizar a entrada o estoque do produto é zerado antes de somar a quantidade — o produto termina com exatamente o que veio na nota.';
COMMENT ON COLUMN entrada_itens.zerar_estoque_antes IS
  'Mesma coisa da coluna homônima em nfe_itens, para a entrada manual.';
