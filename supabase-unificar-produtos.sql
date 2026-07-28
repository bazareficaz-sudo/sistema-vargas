-- Unificação manual de cadastro de produtos duplicados. Nunca apaga a linha
-- do produto perdedor (o sistema nunca fez hard-delete de produtos até
-- hoje, e várias tabelas filhas têm ON DELETE CASCADE/RESTRICT que tornariam
-- um DELETE arriscado) — em vez disso, realoca todas as referências pro
-- produto vencedor e só desativa o(s) perdedor(es) no final, com rastro de
-- auditoria em mesclado_em/mesclado_em_data.

ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS mesclado_em UUID REFERENCES produtos(id),
  ADD COLUMN IF NOT EXISTS mesclado_em_data TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION unificar_produtos(
  p_vencedor_id UUID,
  p_perdedor_ids UUID[],
  p_campos JSONB,   -- {nome, sku, ean, categoria, marca, descricao_marketplace, preco_venda, preco_custo, unidade, tags[]}
  p_imagens JSONB   -- [{url, ordem, principal}] já resolvido pela UI (seleção final)
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_empresa_id UUID;
BEGIN
  SELECT empresa_id INTO v_empresa_id FROM produtos WHERE id = p_vencedor_id;

  -- 1. Aplica os campos escolhidos no vencedor
  UPDATE produtos SET
    nome = COALESCE(p_campos->>'nome', nome),
    sku = p_campos->>'sku',
    ean = p_campos->>'ean',
    categoria = p_campos->>'categoria',
    marca = p_campos->>'marca',
    descricao_marketplace = p_campos->>'descricao_marketplace',
    preco_venda = COALESCE((p_campos->>'preco_venda')::numeric, preco_venda),
    preco_custo = COALESCE((p_campos->>'preco_custo')::numeric, preco_custo),
    unidade = COALESCE(p_campos->>'unidade', unidade),
    tags = ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_campos->'tags', '[]'::jsonb))),
    updated_at = now()
  WHERE id = p_vencedor_id;

  -- 2. produto_estoque: soma quantidade por depósito (são cadastros
  -- duplicados do MESMO item físico — o estoque de cada um é real e precisa
  -- se somar, não descartar). Inclui o próprio vencedor na soma pra não
  -- perder o que ele já tinha.
  INSERT INTO produto_estoque (empresa_id, deposito_id, produto_id, quantidade)
  SELECT v_empresa_id, pe.deposito_id, p_vencedor_id, SUM(pe.quantidade)
  FROM produto_estoque pe
  WHERE pe.produto_id = ANY(array_append(p_perdedor_ids, p_vencedor_id))
  GROUP BY pe.deposito_id
  ON CONFLICT (empresa_id, deposito_id, produto_id)
  DO UPDATE SET quantidade = EXCLUDED.quantidade, updated_at = now();

  DELETE FROM produto_estoque WHERE produto_id = ANY(p_perdedor_ids);

  -- 3. Campo resumo produtos.estoque, recalculado a partir do consolidado
  UPDATE produtos SET estoque = (
    SELECT COALESCE(SUM(quantidade), 0) FROM produto_estoque WHERE produto_id = p_vencedor_id
  ) WHERE id = p_vencedor_id;

  -- 4. Imagens: substitui as do vencedor pela seleção final escolhida na UI
  -- (arquivo no Storage não é movido, só a referência no banco)
  DELETE FROM produto_imagens WHERE produto_id = p_vencedor_id;
  INSERT INTO produto_imagens (empresa_id, produto_id, url, ordem, principal)
  SELECT v_empresa_id, p_vencedor_id, img->>'url', (img->>'ordem')::int, COALESCE((img->>'principal')::boolean, false)
  FROM jsonb_array_elements(COALESCE(p_imagens, '[]'::jsonb)) AS img;

  -- 5. kit_itens: perdedor como componente de kit — soma quantidade se o
  -- vencedor já é componente do mesmo kit, senão só reponta
  INSERT INTO kit_itens (kit_id, produto_id, quantidade, controla_estoque)
  SELECT ki.kit_id, p_vencedor_id, SUM(ki.quantidade), bool_or(ki.controla_estoque)
  FROM kit_itens ki
  WHERE ki.produto_id = ANY(p_perdedor_ids)
  GROUP BY ki.kit_id
  ON CONFLICT (kit_id, produto_id)
  DO UPDATE SET quantidade = kit_itens.quantidade + EXCLUDED.quantidade;

  DELETE FROM kit_itens WHERE produto_id = ANY(p_perdedor_ids);

  -- 6. produto_canal_preferencias: mantém a do vencedor se já existir uma
  -- pro mesmo canal, senão reponta
  UPDATE produto_canal_preferencias pcp SET produto_id = p_vencedor_id
  WHERE pcp.produto_id = ANY(p_perdedor_ids)
    AND NOT EXISTS (
      SELECT 1 FROM produto_canal_preferencias v
      WHERE v.produto_id = p_vencedor_id AND v.canal_id = pcp.canal_id
    );
  DELETE FROM produto_canal_preferencias WHERE produto_id = ANY(p_perdedor_ids);

  -- 7. produto_vinculos (Parcerias entre Empresas): mantém o vínculo do
  -- vencedor se já existir um na mesma parceria, senão reponta
  UPDATE produto_vinculos pv SET produto_id_a = p_vencedor_id
  WHERE pv.produto_id_a = ANY(p_perdedor_ids)
    AND NOT EXISTS (SELECT 1 FROM produto_vinculos v2 WHERE v2.parceria_id = pv.parceria_id AND v2.produto_id_a = p_vencedor_id);
  DELETE FROM produto_vinculos WHERE produto_id_a = ANY(p_perdedor_ids);

  UPDATE produto_vinculos pv SET produto_id_b = p_vencedor_id
  WHERE pv.produto_id_b = ANY(p_perdedor_ids)
    AND NOT EXISTS (SELECT 1 FROM produto_vinculos v2 WHERE v2.parceria_id = pv.parceria_id AND v2.produto_id_b = p_vencedor_id);
  DELETE FROM produto_vinculos WHERE produto_id_b = ANY(p_perdedor_ids);

  -- 8. inventario_itens: mantém a contagem do vencedor se o mesmo
  -- inventário já contou os dois, senão reponta
  UPDATE inventario_itens ii SET produto_id = p_vencedor_id
  WHERE ii.produto_id = ANY(p_perdedor_ids)
    AND NOT EXISTS (SELECT 1 FROM inventario_itens v3 WHERE v3.inventario_id = ii.inventario_id AND v3.produto_id = p_vencedor_id);
  DELETE FROM inventario_itens WHERE produto_id = ANY(p_perdedor_ids);

  -- 9. Demais tabelas — sem risco de conflito de unicidade, reponta direto
  UPDATE venda_itens SET produto_id = p_vencedor_id WHERE produto_id = ANY(p_perdedor_ids);
  UPDATE marketplace_anuncios SET produto_id = p_vencedor_id WHERE produto_id = ANY(p_perdedor_ids);
  UPDATE marketplace_anuncio_variacoes SET produto_id = p_vencedor_id WHERE produto_id = ANY(p_perdedor_ids);
  UPDATE marketplace_mapeamentos SET produto_id = p_vencedor_id WHERE produto_id = ANY(p_perdedor_ids);
  UPDATE marketplace_pedido_itens SET produto_id = p_vencedor_id WHERE produto_id = ANY(p_perdedor_ids);
  UPDATE nfe_itens SET produto_id = p_vencedor_id WHERE produto_id = ANY(p_perdedor_ids);
  UPDATE nfe_mapeamentos SET produto_id = p_vencedor_id WHERE produto_id = ANY(p_perdedor_ids);
  UPDATE orcamento_itens SET produto_id = p_vencedor_id WHERE produto_id = ANY(p_perdedor_ids);
  UPDATE estoque_movimentacoes SET produto_id = p_vencedor_id WHERE produto_id = ANY(p_perdedor_ids);
  UPDATE entrada_itens SET produto_id = p_vencedor_id WHERE produto_id = ANY(p_perdedor_ids);
  UPDATE marketplace_enriquecimento_historico SET produto_id = p_vencedor_id WHERE produto_id = ANY(p_perdedor_ids);
  UPDATE pedidos_compra_itens SET produto_id = p_vencedor_id WHERE produto_id = ANY(p_perdedor_ids);
  UPDATE historico_precos SET produto_id = p_vencedor_id WHERE produto_id = ANY(p_perdedor_ids);
  UPDATE faltas SET produto_id = p_vencedor_id::text WHERE produto_id = ANY(p_perdedor_ids::text[]);
  UPDATE incentivo_historico SET produto_id = p_vencedor_id::text WHERE produto_id = ANY(p_perdedor_ids::text[]);

  -- 10. Desativa os perdedores — nunca apaga a linha, só marca como mesclada
  UPDATE produtos SET ativo = false, mesclado_em = p_vencedor_id, mesclado_em_data = now(), updated_at = now()
  WHERE id = ANY(p_perdedor_ids);
END;
$$;
