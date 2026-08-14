-- Subcategoria no cadastro do produto.
--
-- A tabela `categorias` já tinha `pai_id` desde o começo, mas o cadastro do
-- produto nunca soube disso: gravava um único texto em `produtos.categoria` e
-- oferecia a lista inteira achatada. O resultado, medido na base do Silvano:
-- 102 categorias, das quais só 2 são subcategorias de verdade. TORNEIRAS,
-- REGISTROS, RALOS E GRELHAS e CONEXAO SOLDAVEL estão soltas no mesmo nível
-- de MATERIAL HIDRÁULICO, quando são partes dele.
--
-- `subcategoria` entra como TEXTO, e não como chave estrangeira, pelo mesmo
-- motivo que `categoria` é texto: dezenas de telas, relatórios e a IA leem
-- esse campo por nome. Trocar por id seria outro projeto; o que resolve a dor
-- de hoje é ter o segundo nível.

ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS subcategoria TEXT;

COMMENT ON COLUMN produtos.subcategoria IS
  'Segundo nível da classificação. O primeiro está em `categoria`. Ambos guardam o NOME da categoria, não o id.';

-- Filtro por categoria + subcategoria aparece em listagem de produtos,
-- relatórios e etiquetas.
CREATE INDEX IF NOT EXISTS idx_produtos_subcategoria
  ON produtos (empresa_id, categoria, subcategoria);
