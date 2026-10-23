-- Banner por categoria: o pedido foi "colocar banner em algumas categorias",
-- como na página de Lâmpadas. Até aqui `loja_banners` só conhecia duas
-- posições — 'hero' (carrossel do topo da home) e 'intermediario' (nunca lida
-- por nada) — e nenhuma ligava o banner a uma categoria.
--
-- Mudança aditiva:
--   * `loja_categoria_id`: a categoria (ou subcategoria — é a mesma tabela) onde
--     o banner aparece. NULL para os banners da home, como são hoje.
--   * posição nova 'categoria'.
--   * CHECK amarrando as duas coisas: banner de categoria TEM categoria, e
--     banner que tem categoria É de categoria. Sem isso, um 'hero' com
--     categoria preenchida ou um 'categoria' sem categoria ficariam salvos e
--     nunca apareceriam em lugar nenhum — o mesmo erro que o campo
--     `posicao = 'intermediario'` já carrega.
--
-- Os banners existentes (todos 'hero', categoria NULL) satisfazem o CHECK sem
-- mexer em linha nenhuma, e a vitrine da home continua lendo só `posicao =
-- 'hero'` — banner de categoria nunca vaza para o carrossel do topo.
--
-- ON DELETE CASCADE: apagar a categoria leva os banners dela junto. Banner
-- sem categoria não tem onde aparecer.
--
-- Idempotente.

ALTER TABLE loja_banners
  ADD COLUMN IF NOT EXISTS loja_categoria_id UUID REFERENCES loja_categorias(id) ON DELETE CASCADE;

ALTER TABLE loja_banners DROP CONSTRAINT IF EXISTS loja_banners_posicao_chk;
ALTER TABLE loja_banners ADD CONSTRAINT loja_banners_posicao_chk
  CHECK (posicao IN ('hero', 'intermediario', 'categoria'));

ALTER TABLE loja_banners DROP CONSTRAINT IF EXISTS loja_banners_categoria_chk;
ALTER TABLE loja_banners ADD CONSTRAINT loja_banners_categoria_chk
  CHECK ((posicao = 'categoria') = (loja_categoria_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_loja_banners_categoria
  ON loja_banners (loja_id, loja_categoria_id, ordem)
  WHERE ativo AND loja_categoria_id IS NOT NULL;

COMMENT ON COLUMN loja_banners.loja_categoria_id IS
  'Só para posicao = ''categoria''. Categoria ou subcategoria (loja_categorias) onde o banner aparece; subcategoria sem banner próprio herda o da categoria-mãe.';

NOTIFY pgrst, 'reload schema';
