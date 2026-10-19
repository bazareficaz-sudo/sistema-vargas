-- ENVIO POR CATEGORIA: mostrar ANTES de montar a fila quem vai receber e por
-- que os outros ficam de fora — e não criar fila vazia.
--
-- No primeiro teste a fila saiu com 0 pessoas sem explicação: o único
-- cliente da categoria tinha o número de um destinatário da Betina (equipe),
-- que fica de fora de propósito. A regra estava certa; a tela é que não dizia.
--
-- 1. whatsapp_lote_candidatos(): cada cliente da categoria com o PRIMEIRO
--    motivo que o tira da fila (ou 'ok'). Uma regra só para a prévia e para
--    montar a fila. Interna: só as funções abaixo chamam.
-- 2. whatsapp_lote_previa(): contagem por motivo, para a tela.
-- 3. whatsapp_lote_criar(): passa a usar os candidatos e recusa fila vazia.
--
-- Depende de 20261020180000_whatsapp_envio_categoria.sql. Aditiva e idempotente.

CREATE OR REPLACE FUNCTION whatsapp_lote_candidatos(p_empresa UUID, p_categoria UUID, p_comprou_dias INT)
RETURNS TABLE (cliente_id UUID, nome TEXT, cel TEXT, motivo TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT c.id, c.nome, c.mesclado_em, c.ativo, c.opt_out_whatsapp,
           coalesce(whatsapp_celular(c.whatsapp), whatsapp_celular(c.telefone_whatsapp), whatsapp_celular(c.telefone)) AS cel
      FROM clientes c
      JOIN cliente_categoria_vinculos v ON v.cliente_id = c.id AND v.categoria_id = p_categoria
     WHERE c.empresa_id = p_empresa
  )
  SELECT b.id, b.nome, b.cel,
         CASE
           WHEN b.mesclado_em IS NOT NULL OR NOT coalesce(b.ativo, true) THEN 'cadastro'
           WHEN coalesce(b.opt_out_whatsapp, false) THEN 'nao_quer'
           WHEN b.cel IS NULL THEN 'sem_celular'
           WHEN EXISTS (
             SELECT 1 FROM getulio_config g, jsonb_array_elements(coalesce(g.destinatarios, '[]'::jsonb)) d
              WHERE g.empresa_id = p_empresa AND tel_chave(d->>'numero') = tel_chave(b.cel)) THEN 'equipe'
           WHEN p_comprou_dias IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM vendas s
              WHERE s.cliente_id = b.id AND s.empresa_id = p_empresa AND s.status = 'concluida'
                AND s.created_at >= now() - make_interval(days => p_comprou_dias)) THEN 'nao_comprou'
           WHEN EXISTS (
             SELECT 1 FROM whatsapp_lote_itens i
              WHERE i.empresa_id = p_empresa AND (i.cliente_id = b.id OR i.telefone = b.cel)
                AND i.status IN ('enviando', 'enviado', 'incerto')
                AND i.reservado_em >= whatsapp_lote_agora() - interval '7 days') THEN 'recente'
           ELSE 'ok'
         END
    FROM base b
$$;

REVOKE ALL ON FUNCTION whatsapp_lote_candidatos(UUID, UUID, INT) FROM PUBLIC, anon, authenticated;

-- ── Prévia: quantos entram e por que os outros ficam de fora ─────────────
CREATE OR REPLACE FUNCTION whatsapp_lote_previa(p_empresa UUID, p_categoria UUID, p_comprou_dias INT DEFAULT NULL)
RETURNS TABLE (na_categoria INT, entram INT, repetidos INT, cadastro INT, nao_quer INT, sem_celular INT, equipe INT, nao_comprou INT, recente INT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (empresa_do_meu_grupo(p_empresa) OR is_system_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cliente_categorias k WHERE k.id = p_categoria AND k.empresa_id = p_empresa) THEN
    RAISE EXCEPTION 'Escolha uma categoria desta empresa.' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  SELECT count(*)::int,
         count(DISTINCT x.cel) FILTER (WHERE x.motivo = 'ok')::int,
         (count(*) FILTER (WHERE x.motivo = 'ok') - count(DISTINCT x.cel) FILTER (WHERE x.motivo = 'ok'))::int,
         count(*) FILTER (WHERE x.motivo = 'cadastro')::int,
         count(*) FILTER (WHERE x.motivo = 'nao_quer')::int,
         count(*) FILTER (WHERE x.motivo = 'sem_celular')::int,
         count(*) FILTER (WHERE x.motivo = 'equipe')::int,
         count(*) FILTER (WHERE x.motivo = 'nao_comprou')::int,
         count(*) FILTER (WHERE x.motivo = 'recente')::int
    FROM whatsapp_lote_candidatos(p_empresa, p_categoria, p_comprou_dias) x;
END $$;

REVOKE ALL ON FUNCTION whatsapp_lote_previa(UUID, UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_lote_previa(UUID, UUID, INT) TO authenticated;

-- ── Montar a fila: mesma regra da prévia; fila vazia não é criada ────────
CREATE OR REPLACE FUNCTION whatsapp_lote_criar(
  p_empresa UUID, p_nome TEXT, p_mensagem TEXT, p_categoria UUID, p_comprou_dias INT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lote UUID;
  v_categoria TEXT;
  v_total INT;
  v_operador TEXT;
BEGIN
  IF NOT (empresa_do_meu_grupo(p_empresa) OR is_system_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.' USING ERRCODE = '42501';
  END IF;
  SELECT k.nome INTO v_categoria FROM cliente_categorias k WHERE k.id = p_categoria AND k.empresa_id = p_empresa;
  IF v_categoria IS NULL THEN
    RAISE EXCEPTION 'Escolha uma categoria desta empresa.' USING ERRCODE = 'P0001';
  END IF;
  IF p_comprou_dias IS NOT NULL AND p_comprou_dias NOT BETWEEN 1 AND 3650 THEN
    RAISE EXCEPTION 'Período de compra inválido.' USING ERRCODE = 'P0001';
  END IF;
  SELECT nullif(btrim(p.nome), '') INTO v_operador FROM profiles p WHERE p.id = auth.uid();

  INSERT INTO whatsapp_lotes (empresa_id, nome, mensagem, categoria_id, categoria_nome, comprou_dias, criado_por_nome)
  VALUES (p_empresa, left(btrim(coalesce(nullif(btrim(p_nome), ''), v_categoria)), 80), btrim(p_mensagem), p_categoria, v_categoria, p_comprou_dias, v_operador)
  RETURNING id INTO v_lote;

  -- Um por telefone; no máximo 500.
  INSERT INTO whatsapp_lote_itens (lote_id, empresa_id, cliente_id, nome, telefone, ordem)
  SELECT v_lote, p_empresa, e.cliente_id, e.nome, e.cel, row_number() OVER (ORDER BY e.nome, e.cliente_id)
    FROM (
      SELECT DISTINCT ON (x.cel) x.cliente_id, x.nome, x.cel
        FROM whatsapp_lote_candidatos(p_empresa, p_categoria, p_comprou_dias) x
       WHERE x.motivo = 'ok'
       ORDER BY x.cel, x.nome
       LIMIT 500
    ) e;

  GET DIAGNOSTICS v_total = ROW_COUNT;
  IF v_total = 0 THEN
    -- Desfaz o lote (a exceção volta a transação inteira).
    RAISE EXCEPTION 'Ninguém desta categoria pode receber agora. Veja na prévia por que cada um ficou de fora.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE whatsapp_lotes SET total = v_total WHERE id = v_lote;
  RETURN v_lote;
END $$;

REVOKE ALL ON FUNCTION whatsapp_lote_criar(UUID, TEXT, TEXT, UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_lote_criar(UUID, TEXT, TEXT, UUID, INT) TO authenticated;
