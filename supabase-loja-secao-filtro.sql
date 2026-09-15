-- Seções da home configuráveis por critério: o pedido foi "criar meios do
-- usuário criar seções... configurar os produtos que irão aparecer ali,
-- sendo TAG, MARCA, CATEGORIA ou SUBCATEGORIA".
--
-- Não precisa de coluna nova — `loja_vitrine_produtos` já expõe `marca`,
-- `categoria_erp`, `subcategoria_erp` e (desde a migração anterior) `tags`.
-- Só falta o `loja_blocos_home.tipo` aceitar o valor novo. O `config` deste
-- tipo é `{"criterio": "tag"|"marca"|"categoria"|"subcategoria", "valor": "..."}`.
--
-- Idempotente: pode rodar de novo sem efeito colateral.

ALTER TABLE loja_blocos_home DROP CONSTRAINT IF EXISTS loja_blocos_tipo_chk;
ALTER TABLE loja_blocos_home ADD CONSTRAINT loja_blocos_tipo_chk CHECK (tipo IN
  ('destaques', 'ofertas', 'novidades', 'mais_vendidos', 'categorias', 'marcas', 'selecao', 'destaque_tag', 'secao_filtro'));

COMMENT ON COLUMN loja_blocos_home.config IS
  'Depende de `tipo`. selecao: {"produto_ids": [...]}. destaque_tag: {"tag": "..."} (carrossel do topo). secao_filtro: {"criterio": "tag"|"marca"|"categoria"|"subcategoria", "valor": "..."} (seção comum, grade de cards).';

-- Lição registrada em docs/retomar-aqui.md e repetida aqui: depois de mexer
-- em CHECK/coluna, recarregar o cache de esquema do PostgREST — sem isto ele
-- pode responder consulta errada por alguns instantes, e a migração anterior
-- desta sessão (supabase-loja-home-editor.sql) pulou este passo.
NOTIFY pgrst, 'reload schema';
