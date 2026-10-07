-- Produtos similares: o mesmo item de marcas diferentes.
--
-- Na loja de material elétrico isso é o dia inteiro — "Disjuntor Monopolar
-- DIN 32A" da Steck, da WEG, da Schneider, com a mesma descrição e só a
-- marca mudando. No PDV o vendedor escolhe um deles na busca e, sem ver a
-- marca, leva o errado.
--
-- `grupo_similar` é o rótulo que junta esses produtos. Quem define é o
-- gestor, no cadastro do produto — e não o sistema adivinhando pelo nome,
-- porque "Disjuntor DIN 32A" e "Disjuntor DIN 25A" têm nome quase idêntico e
-- NÃO são similares: juntá-los automaticamente produziria exatamente o erro
-- que esta coluna existe para evitar.
--
-- Ao escolher na busca um produto que tem grupo, o PDV abre a lista do grupo
-- com marca, estoque e preço de cada um para o vendedor confirmar.
--
-- Guardado normalizado (maiúsculas, espaços simples) pela aplicação, para
-- "disjuntor 32a" e "DISJUNTOR  32A" caírem no mesmo grupo. Nulo = sem grupo.

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS grupo_similar TEXT;

COMMENT ON COLUMN produtos.grupo_similar IS
  'Rótulo que junta produtos equivalentes de marcas diferentes. O PDV mostra o grupo para o vendedor escolher a marca.';

CREATE INDEX IF NOT EXISTS idx_produtos_grupo_similar
  ON produtos (empresa_id, grupo_similar)
  WHERE grupo_similar IS NOT NULL;
