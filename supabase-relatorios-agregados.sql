-- ============================================================
-- RELATÓRIOS — somar no banco, não no navegador
--
-- O DEFEITO QUE ESTE ARQUIVO CONSERTA:
--
-- O PostgREST devolve no máximo 1.000 linhas por requisição. Toda tela que
-- buscava as vendas e somava `total` em JavaScript estava, portanto, somando
-- só as 1.000 primeiras — em silêncio, sem erro, sem aviso.
--
-- Medido na Bazar Eficaz em 27/08/2026:
--   agosto tem 1.701 vendas concluídas ........... R$ 45.012,53
--   o card "Faturamento do mês" mostrava ......... R$ 26.614,94
--   (exatamente a soma das 1.000 mais antigas)
--
-- Em julho, com 395 vendas, o mesmo código acertava. É um defeito que nasce
-- quando o movimento cresce — o pior tipo, porque aparece justo quando o
-- número passa a importar.
--
-- Tentativa descartada: pedir `total.sum()` direto ao PostgREST. Este projeto
-- responde `PGRST123 — Use of aggregate functions is not allowed`. Ligar
-- agregação afetaria a API inteira; uma função por pergunta é mais contida.
--
-- POR QUE FUNÇÃO, E NÃO PAGINAÇÃO, NESTES TRÊS CASOS:
-- quando a tela quer UM número (ou uma lista já agrupada), trazer 1.701 linhas
-- para o servidor e reduzi-las é trabalho jogado fora. Onde a tela precisa das
-- linhas de verdade (curva ABC, venda por hora), a correção é outra e está no
-- código: `src/lib/supabase/paginar.ts`.
--
-- SEGURANÇA: `vendas`, `venda_itens` e `produtos` estão HOJE sem RLS (dívida
-- registrada em docs/seguranca-fechar-acesso-anon.md). Então a checagem de
-- empresa é feita aqui dentro, explicitamente, com a mesma função que o resto
-- do sistema usa — e o `anon` não recebe permissão de executar nenhuma delas.
--
-- Aditivo: só cria funções. Nenhuma tabela, coluna ou linha é tocada.
-- Execute no Supabase Dashboard → SQL Editor.
-- ============================================================


-- ============================================================
-- 1. Resumo de vendas de um período
--
-- Responde o que os cards de KPI perguntam: quanto faturou, em quantas
-- vendas, com quanto de desconto. `p_fim` é EXCLUSIVO (>= início, < fim) —
-- assim o chamador passa o primeiro instante do mês seguinte e não precisa
-- se preocupar com 23:59:59,999.
-- ============================================================

CREATE OR REPLACE FUNCTION vendas_resumo(
  p_empresa UUID,
  p_inicio  TIMESTAMPTZ,
  p_fim     TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (faturamento NUMERIC, quantidade BIGINT, desconto NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT empresa_do_meu_grupo(p_empresa) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;

  RETURN QUERY
  SELECT COALESCE(SUM(v.total), 0)::NUMERIC,
         COUNT(*)::BIGINT,
         COALESCE(SUM(v.desconto), 0)::NUMERIC
  FROM vendas v
  WHERE v.empresa_id = p_empresa
    AND v.status = 'concluida'
    AND v.created_at >= p_inicio
    AND (p_fim IS NULL OR v.created_at < p_fim);
END;
$$;

COMMENT ON FUNCTION vendas_resumo(UUID, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Faturamento, quantidade e desconto de vendas concluídas no período. Existe porque somar no cliente trunca em 1.000 linhas.';


-- ============================================================
-- 2. Vendas por dia
--
-- A série do gráfico de evolução. Devolve só os dias COM venda; quem desenha
-- preenche os vazios (a tela já fazia isso).
-- ============================================================

CREATE OR REPLACE FUNCTION vendas_por_dia(
  p_empresa UUID,
  p_inicio  TIMESTAMPTZ,
  p_fim     TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (dia DATE, faturamento NUMERIC, quantidade BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT empresa_do_meu_grupo(p_empresa) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;

  RETURN QUERY
  -- Agrupa no fuso de São Paulo, e não em UTC: uma venda das 21h de terça
  -- pertence a terça para quem vendeu, mesmo que em UTC já seja quarta.
  SELECT (v.created_at AT TIME ZONE 'America/Sao_Paulo')::DATE,
         COALESCE(SUM(v.total), 0)::NUMERIC,
         COUNT(*)::BIGINT
  FROM vendas v
  WHERE v.empresa_id = p_empresa
    AND v.status = 'concluida'
    AND v.created_at >= p_inicio
    AND (p_fim IS NULL OR v.created_at < p_fim)
  GROUP BY 1
  ORDER BY 1;
END;
$$;


-- ============================================================
-- 3. Produtos vendidos no período
--
-- Substitui um padrão que já estava quebrado por DOIS motivos: buscava os ids
-- das vendas (truncados em 1.000) e depois mandava todos eles num
-- `.in('venda_id', [...])` — 2.016 UUIDs viram uma URL de dezenas de
-- kilobytes, que servidor nenhum aceita. O join pertence ao banco.
--
-- `lucro` usa o custo gravado no item da venda, e só cai no custo atual do
-- cadastro quando aquele não existe: o custo de hoje não descreve a margem de
-- uma venda de junho.
-- ============================================================

CREATE OR REPLACE FUNCTION produtos_vendidos(
  p_empresa UUID,
  p_inicio  TIMESTAMPTZ,
  p_fim     TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (produto_id TEXT, quantidade NUMERIC, faturamento NUMERIC, lucro NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT empresa_do_meu_grupo(p_empresa) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;

  RETURN QUERY
  SELECT vi.produto_id,
         COALESCE(SUM(vi.quantidade), 0)::NUMERIC,
         COALESCE(SUM(vi.quantidade * vi.preco_unitario), 0)::NUMERIC,
         COALESCE(SUM(
           vi.quantidade * (vi.preco_unitario - COALESCE(vi.custo_unitario, p.preco_custo, 0))
         ), 0)::NUMERIC
  FROM venda_itens vi
  -- `venda_itens.venda_id` e `produto_id` sao TEXT, nao UUID — heranca da
  -- migracao do sistema antigo. O cast e obrigatorio: sem ele o Postgres
  -- recusa a comparacao (`operator does not exist: uuid = text`), e foi
  -- exatamente assim que a primeira versao desta funcao falhou.
  JOIN vendas v ON v.id::TEXT = vi.venda_id
  LEFT JOIN produtos p ON p.id::TEXT = vi.produto_id
  WHERE v.empresa_id = p_empresa
    AND v.status = 'concluida'
    AND v.created_at >= p_inicio
    AND (p_fim IS NULL OR v.created_at < p_fim)
    AND vi.produto_id IS NOT NULL
  GROUP BY vi.produto_id;
END;
$$;


-- ============================================================
-- 4. Vendas por cliente
--
-- Alimenta o ranking de clientes e o alerta de "cliente VIP sumido".
-- `ultima_compra` vem junto porque a pergunta do alerta é sempre a mesma:
-- quanto ele já comprou, e há quanto tempo não aparece.
-- ============================================================

CREATE OR REPLACE FUNCTION vendas_por_cliente(
  p_empresa UUID,
  p_inicio  TIMESTAMPTZ DEFAULT NULL,
  p_fim     TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (cliente_id UUID, total NUMERIC, quantidade BIGINT, ultima_compra TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT empresa_do_meu_grupo(p_empresa) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;

  RETURN QUERY
  SELECT v.cliente_id,
         COALESCE(SUM(v.total), 0)::NUMERIC,
         COUNT(*)::BIGINT,
         MAX(v.created_at)
  FROM vendas v
  WHERE v.empresa_id = p_empresa
    AND v.status = 'concluida'
    AND v.cliente_id IS NOT NULL
    AND (p_inicio IS NULL OR v.created_at >= p_inicio)
    AND (p_fim    IS NULL OR v.created_at <  p_fim)
  GROUP BY v.cliente_id;
END;
$$;


-- ============================================================
-- 5. Resumo do estoque
--
-- O capital em estoque é o pior caso do defeito: são 14.263 produtos ativos,
-- e o relatório calculava sobre os 1.000 primeiros. Mostrava R$ 4 mil onde o
-- valor é R$ 66 mil — erro de uma ordem de grandeza numa tela usada para
-- decidir compra.
-- ============================================================

CREATE OR REPLACE FUNCTION estoque_resumo(p_empresa UUID)
RETURNS TABLE (
  capital NUMERIC, produtos_ativos BIGINT,
  sem_estoque BIGINT, abaixo_minimo BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT empresa_do_meu_grupo(p_empresa) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(GREATEST(COALESCE(p.estoque, 0), 0) * COALESCE(p.preco_custo, 0)), 0)::NUMERIC,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE COALESCE(p.estoque, 0) <= 0)::BIGINT,
    COUNT(*) FILTER (
      WHERE COALESCE(p.estoque_minimo, 0) > 0
        AND COALESCE(p.estoque, 0) < p.estoque_minimo
        AND COALESCE(p.estoque, 0) > 0
    )::BIGINT
  FROM produtos p
  WHERE p.empresa_id = p_empresa AND p.ativo;
END;
$$;

-- Estoque negativo não vira capital negativo: 586 produtos estão com saldo
-- abaixo de zero por causa da baixa que o sistema absorve de propósito, e
-- somá-los como dinheiro negativo esconderia o capital de quem tem saldo.


-- ============================================================
-- 6. Permissões
--
-- O `anon` não executa nenhuma delas. Isso NÃO fecha o buraco atual (as
-- tabelas seguem legíveis pela chave anônima — ver
-- docs/seguranca-fechar-acesso-anon.md), mas garante que este arquivo não
-- abra uma porta a mais.
-- ============================================================

REVOKE ALL ON FUNCTION vendas_resumo(UUID, TIMESTAMPTZ, TIMESTAMPTZ)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION vendas_por_dia(UUID, TIMESTAMPTZ, TIMESTAMPTZ)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION produtos_vendidos(UUID, TIMESTAMPTZ, TIMESTAMPTZ)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION vendas_por_cliente(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION estoque_resumo(UUID)                               FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION vendas_resumo(UUID, TIMESTAMPTZ, TIMESTAMPTZ)      TO authenticated;
GRANT EXECUTE ON FUNCTION vendas_por_dia(UUID, TIMESTAMPTZ, TIMESTAMPTZ)     TO authenticated;
GRANT EXECUTE ON FUNCTION produtos_vendidos(UUID, TIMESTAMPTZ, TIMESTAMPTZ)  TO authenticated;
GRANT EXECUTE ON FUNCTION vendas_por_cliente(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION estoque_resumo(UUID)                               TO authenticated;


-- ============================================================
-- COMO CONFERIR (rodar depois, com o id da Bazar Eficaz)
--
--   SELECT * FROM vendas_resumo(
--     'a1000000-0000-0000-0000-000000000001',
--     '2026-08-01T03:00:00Z', '2026-09-01T03:00:00Z');
--   -- esperado em 27/08/2026: 45012.53 · 1701 vendas
--
--   SELECT * FROM estoque_resumo('a1000000-0000-0000-0000-000000000001');
--   -- esperado em 27/08/2026: capital 85.148,73 sobre 14.263 ativos,
--   -- 13.641 sem estoque. O capital ignora saldo negativo (GREATEST): somar
--   -- -3 unidades como dinheiro negativo abateria o estoque de quem tem.
--
-- COMO DESFAZER
--   DROP FUNCTION IF EXISTS vendas_resumo(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
--   DROP FUNCTION IF EXISTS vendas_por_dia(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
--   DROP FUNCTION IF EXISTS produtos_vendidos(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
--   DROP FUNCTION IF EXISTS vendas_por_cliente(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
--   DROP FUNCTION IF EXISTS estoque_resumo(UUID);
-- Nenhum dado é alterado por este arquivo.
-- ============================================================
