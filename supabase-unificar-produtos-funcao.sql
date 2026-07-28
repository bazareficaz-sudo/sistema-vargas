-- Correção definitiva: a seção 9 agora descobre o tipo real de cada coluna
-- produto_id em tempo de execução (algumas são uuid, outras text — schema
-- inconsistente herdado de migrações antigas conflitantes) e monta o UPDATE
-- certo dinamicamente, em vez de assumir um tipo fixo por tabela.
-- Só a função (as colunas mesclado_em/mesclado_em_data já existem).

CREATE OR REPLACE FUNCTION unificar_produtos(
  p_vencedor_id UUID,
  p_perdedor_ids UUID[],
  p_campos JSONB,
  p_imagens JSONB
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_empresa_id UUID;
  v_tabela TEXT;
  v_tipo TEXT;
  v_tabelas TEXT[] := ARRAY[
    'venda_itens', 'marketplace_anuncios', 'marketplace_anuncio_variacoes',
    'marketplace_mapeamentos', 'marketplace_pedido_itens', 'nfe_itens', 'nfe_mapeamentos',
    'orcamento_itens', 'estoque_movimentacoes', 'entrada_itens',
    'marketplace_enriquecimento_historico', 'pedidos_compra_itens', 'historico_precos',
    'faltas', 'incentivo_historico'
  ];
BEGIN
  SELECT empresa_id INTO v_empresa_id FROM produtos WHERE id = p_vencedor_id;

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

  INSERT INTO produto_estoque (empresa_id, deposito_id, produto_id, quantidade)
  SELECT v_empresa_id, pe.deposito_id, p_vencedor_id, SUM(pe.quantidade)
  FROM produto_estoque pe
  WHERE pe.produto_id = ANY(array_append(p_perdedor_ids, p_vencedor_id))
  GROUP BY pe.deposito_id
  ON CONFLICT (empresa_id, deposito_id, produto_id)
  DO UPDATE SET quantidade = EXCLUDED.quantidade, updated_at = now();

  DELETE FROM produto_estoque WHERE produto_id = ANY(p_perdedor_ids);

  UPDATE produtos SET estoque = (
    SELECT COALESCE(SUM(quantidade), 0) FROM produto_estoque WHERE produto_id = p_vencedor_id
  ) WHERE id = p_vencedor_id;

  DELETE FROM produto_imagens WHERE produto_id = p_vencedor_id;
  INSERT INTO produto_imagens (empresa_id, produto_id, url, ordem, principal)
  SELECT v_empresa_id, p_vencedor_id, img->>'url', (img->>'ordem')::int, COALESCE((img->>'principal')::boolean, false)
  FROM jsonb_array_elements(COALESCE(p_imagens, '[]'::jsonb)) AS img;

  INSERT INTO kit_itens (kit_id, produto_id, quantidade, controla_estoque)
  SELECT ki.kit_id, p_vencedor_id, SUM(ki.quantidade), bool_or(ki.controla_estoque)
  FROM kit_itens ki
  WHERE ki.produto_id = ANY(p_perdedor_ids)
  GROUP BY ki.kit_id
  ON CONFLICT (kit_id, produto_id)
  DO UPDATE SET quantidade = kit_itens.quantidade + EXCLUDED.quantidade;

  DELETE FROM kit_itens WHERE produto_id = ANY(p_perdedor_ids);

  UPDATE produto_canal_preferencias pcp SET produto_id = p_vencedor_id
  WHERE pcp.produto_id = ANY(p_perdedor_ids)
    AND NOT EXISTS (
      SELECT 1 FROM produto_canal_preferencias v
      WHERE v.produto_id = p_vencedor_id AND v.canal_id = pcp.canal_id
    );
  DELETE FROM produto_canal_preferencias WHERE produto_id = ANY(p_perdedor_ids);

  UPDATE produto_vinculos pv SET produto_id_a = p_vencedor_id
  WHERE pv.produto_id_a = ANY(p_perdedor_ids)
    AND NOT EXISTS (SELECT 1 FROM produto_vinculos v2 WHERE v2.parceria_id = pv.parceria_id AND v2.produto_id_a = p_vencedor_id);
  DELETE FROM produto_vinculos WHERE produto_id_a = ANY(p_perdedor_ids);

  UPDATE produto_vinculos pv SET produto_id_b = p_vencedor_id
  WHERE pv.produto_id_b = ANY(p_perdedor_ids)
    AND NOT EXISTS (SELECT 1 FROM produto_vinculos v2 WHERE v2.parceria_id = pv.parceria_id AND v2.produto_id_b = p_vencedor_id);
  DELETE FROM produto_vinculos WHERE produto_id_b = ANY(p_perdedor_ids);

  UPDATE inventario_itens ii SET produto_id = p_vencedor_id
  WHERE ii.produto_id = ANY(p_perdedor_ids)
    AND NOT EXISTS (SELECT 1 FROM inventario_itens v3 WHERE v3.inventario_id = ii.inventario_id AND v3.produto_id = p_vencedor_id);
  DELETE FROM inventario_itens WHERE produto_id = ANY(p_perdedor_ids);

  FOREACH v_tabela IN ARRAY v_tabelas LOOP
    SELECT data_type INTO v_tipo FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = v_tabela AND column_name = 'produto_id';

    IF v_tipo IS NULL THEN
      CONTINUE;
    ELSIF v_tipo = 'uuid' THEN
      EXECUTE format('UPDATE %I SET produto_id = $1 WHERE produto_id::text = ANY($2::text[])', v_tabela)
        USING p_vencedor_id, p_perdedor_ids;
    ELSE
      EXECUTE format('UPDATE %I SET produto_id = $1::text WHERE produto_id::text = ANY($2::text[])', v_tabela)
        USING p_vencedor_id, p_perdedor_ids;
    END IF;
  END LOOP;

  UPDATE produtos SET ativo = false, mesclado_em = p_vencedor_id, mesclado_em_data = now(), updated_at = now()
  WHERE id = ANY(p_perdedor_ids);
END;
$$;
