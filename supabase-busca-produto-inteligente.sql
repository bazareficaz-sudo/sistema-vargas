-- Busca de produto "como no balcão" (aplicado em 08/10/2026).
-- Cada grupo é uma palavra da pergunta com seus equivalentes; o produto pontua
-- um acerto por grupo achado no nome/marca (sem acento, sem caixa) ou SKU
-- exato. Os grupos são montados em src/lib/busca/produtoInteligente.ts.
-- Só a chave de serviço executa (a função recebe a empresa por parâmetro).
CREATE OR REPLACE FUNCTION public.buscar_produtos_inteligente(p_empresa uuid, p_grupos jsonb, p_limite int DEFAULT 20)
RETURNS TABLE(id uuid, nome text, sku text, marca text, estoque numeric, preco_venda numeric, ativo boolean, acertos int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
  WITH base AS (
    SELECT p.id, p.nome, p.sku, p.marca, p.estoque, p.preco_venda, p.ativo,
           extensions.unaccent(lower(coalesce(p.nome, '') || ' ' || coalesce(p.marca, ''))) AS txt
    FROM produtos p
    WHERE p.empresa_id = p_empresa
  ),
  pont AS (
    SELECT b.*, (
      SELECT count(*) FROM jsonb_array_elements(p_grupos) g
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(g) a
        WHERE b.txt LIKE '%' || a || '%' OR lower(coalesce(b.sku, '')) = a
      )
    )::int AS acertos
    FROM base b
  )
  SELECT id, nome, sku, marca, estoque, preco_venda, ativo, acertos
  FROM pont WHERE acertos > 0
  ORDER BY acertos DESC, ativo DESC, (estoque > 0) DESC, nome
  LIMIT LEAST(GREATEST(p_limite, 1), 50);
$$;
REVOKE ALL ON FUNCTION public.buscar_produtos_inteligente(uuid, jsonb, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_produtos_inteligente(uuid, jsonb, int) TO service_role;
