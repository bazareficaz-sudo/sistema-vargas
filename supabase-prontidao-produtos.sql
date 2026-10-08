-- PRONTIDÃO PARA ANUNCIAR (aplicado em 08/10/2026): o retrato de cada produto
-- ativo com estoque — o que o cadastro tem (fotos, peso, medidas, descrição,
-- EAN, marca, custo) e em quais plataformas já está anunciado (pelo anúncio
-- ou por variação). A tela decide o que falta por canal
-- (src/lib/anuncios/prontidao.ts).
CREATE OR REPLACE FUNCTION public.prontidao_produtos(p_empresa uuid)
RETURNS TABLE(
  id uuid, nome text, sku text, ean text, marca text, estoque numeric, preco_venda numeric, preco_custo numeric,
  peso_kg numeric, comprimento_cm numeric, largura_cm numeric, altura_cm numeric,
  descricao_marketplace text, fotos int, plataformas text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (empresa_do_meu_grupo(p_empresa) OR is_system_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  RETURN QUERY
  WITH anunciados AS (
    SELECT a.produto_id AS pid, c.plataforma
    FROM marketplace_anuncios a JOIN marketplace_canais c ON c.id = a.canal_id
    WHERE c.empresa_id = p_empresa AND a.produto_id IS NOT NULL AND a.status IN ('ativo', 'pausado', 'rascunho')
    UNION
    SELECT v.produto_id, c.plataforma
    FROM marketplace_anuncio_variacoes v
    JOIN marketplace_anuncios a ON a.id = v.anuncio_id
    JOIN marketplace_canais c ON c.id = a.canal_id
    WHERE c.empresa_id = p_empresa AND v.produto_id IS NOT NULL AND a.status IN ('ativo', 'pausado', 'rascunho')
  )
  SELECT pr.id, pr.nome, pr.sku, pr.ean, pr.marca, COALESCE(pr.estoque, 0), pr.preco_venda, pr.preco_custo,
         pr.peso_kg, pr.comprimento_cm, pr.largura_cm, pr.altura_cm, pr.descricao_marketplace,
         (SELECT count(*)::int FROM produto_imagens i WHERE i.produto_id = pr.id),
         COALESCE((SELECT array_agg(DISTINCT x.plataforma) FROM anunciados x WHERE x.pid = pr.id), '{}')
  FROM produtos pr
  WHERE pr.empresa_id = p_empresa AND pr.ativo AND COALESCE(pr.estoque, 0) > 0
    AND COALESCE(pr.tipo, 'simples') <> 'servico'
  ORDER BY pr.nome;
END;
$$;
GRANT EXECUTE ON FUNCTION public.prontidao_produtos(uuid) TO authenticated, service_role;
