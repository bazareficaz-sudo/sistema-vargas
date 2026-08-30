-- ============================================================
-- LOJA ONLINE — Fase 3 (checkout) e Fase 2 (reserva de estoque)
--
-- As duas juntas de propósito. A Fase 2 estava parada desde 24/08 porque
-- "reservar ao iniciar o checkout" não tinha quem chamasse: o checkout não
-- existia. Separá-las agora seria construir um motor sem ignição.
--
-- ── A decisão de arquitetura, e ela evita uma tabela ────────
--
-- NÃO existe `loja_pedidos`. O pedido da loja é uma linha de
-- `marketplace_pedidos` no canal da loja — e isso não é atalho, é o desenho
-- da Fase 1, que já dizia: "o canal é quem dá identidade de canal de venda à
-- loja dentro do ERP (aparece em Pedidos, em regras de preço, etc.)".
--
-- O que se ganha: a tela `/dashboard/pedidos-ecommerce` consulta
-- `marketplace_pedidos` por empresa SEM filtrar plataforma, então o pedido da
-- loja aparece nela sozinho, e herda o ciclo inteiro que já existe — etapa
-- interna, baixa de estoque, NF-e, vínculo com `vendas`. Uma tabela paralela
-- exigiria repetir tudo isso, e as duas divergiriam.
--
-- ── Por que UMA função e não cinco chamadas ─────────────────
--
-- Criar pedido é: conferir preço, conferir saldo, achar ou criar o cliente,
-- gravar o pedido, gravar os itens, reservar o estoque. Em TypeScript seriam
-- seis idas ao banco sem transação — e uma falha no meio deixaria pedido sem
-- reserva, ou reserva sem pedido, ou cliente órfão. Aqui é uma função, logo
-- uma transação: nasce tudo ou não nasce nada.
--
-- ── A corrida que esta função precisa perder de propósito ───
--
-- Dois clientes comprando a última unidade ao mesmo tempo. Sem trava, os dois
-- passam pela conferência de saldo antes de qualquer um reservar, e a loja
-- vende o que não tem. A trava é `pg_advisory_xact_lock` por produto, tomada
-- em ordem ORDENADA de id — ordenar não é capricho: dois pedidos com os
-- mesmos produtos em ordens diferentes travariam um ao outro.
--
-- ── O que este arquivo NÃO faz ──────────────────────────────
--
-- Não cobra. A loja não tem gateway, e o pagamento é combinado na entrega ou
-- na retirada. `pagamento_forma` grava a escolha do cliente para a loja saber
-- o que levar; nenhum valor é capturado, e não há comprovante.
--
-- Depende de supabase-loja-fundacao.sql, -estoque.sql, -vitrine.sql.
-- Execute no Supabase Dashboard → SQL Editor.
-- ============================================================


-- ============================================================
-- 1. Configuração de pagamento e numeração
-- ============================================================

ALTER TABLE loja_config
  -- O que o cliente pode escolher no checkout. Não cobra nada: diz à loja o
  -- que levar na entrega. Vazio = a loja não pergunta.
  ADD COLUMN IF NOT EXISTS pagamento_formas TEXT[] NOT NULL
    DEFAULT ARRAY['pix','dinheiro','cartao']::TEXT[],
  -- Prefixo do número do pedido, para o cliente e o balcão falarem do mesmo
  -- papel. 'LO-000123'.
  ADD COLUMN IF NOT EXISTS pedido_prefixo TEXT NOT NULL DEFAULT 'LO';

-- Numeração própria, e sequência de verdade em vez de `count(*) + 1` — que
-- repete número sob concorrência, e é exatamente o defeito que este projeto
-- já pagou no SKU (ver supabase-proximo-sku.sql).
CREATE SEQUENCE IF NOT EXISTS loja_pedido_numero_seq START 1;


-- ============================================================
-- 2. FASE 2 — o caminho de escrita da reserva
--
-- A tabela `estoque_reservas` nasceu na Fase 1 e a leitura já a subtrai (ver
-- loja_estoque_disponivel). O que faltava é isto: reservar, consumir,
-- liberar.
--
-- Genérico por canal desde o desenho: `referencia_tipo` diz quem segurou.
-- Hoje só a loja escreve; PDV e marketplace entram quando a decisão de
-- reserva para todos os canais for tomada (ver CONTINUIDADE.md).
-- ============================================================

-- Consome a reserva: o pedido virou venda e o estoque saiu de verdade.
-- Idempotente — chamar duas vezes não faz mal, e vai acontecer, porque a
-- baixa pode ser disparada pelo cron e pelo botão quase juntos.
CREATE OR REPLACE FUNCTION estoque_reserva_consumir(
  p_referencia_tipo TEXT, p_referencia_id TEXT
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE estoque_reservas
     SET status = 'consumida', encerrado_em = now()
   WHERE referencia_tipo = p_referencia_tipo
     AND referencia_id   = p_referencia_id
     AND status = 'ativa';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Libera: o pedido foi cancelado, ou o cliente desistiu. O estoque volta a
-- aparecer na vitrine na leitura seguinte, sem cron nenhum, porque
-- loja_estoque_disponivel só conta reserva 'ativa'.
CREATE OR REPLACE FUNCTION estoque_reserva_liberar(
  p_referencia_tipo TEXT, p_referencia_id TEXT, p_motivo TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE estoque_reservas
     SET status = 'cancelada', encerrado_em = now(),
         observacao = COALESCE(p_motivo, observacao)
   WHERE referencia_tipo = p_referencia_tipo
     AND referencia_id   = p_referencia_id
     AND status = 'ativa';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION estoque_reserva_consumir(TEXT, TEXT) IS
  'Marca as reservas de uma referência como consumidas. Idempotente.';
COMMENT ON FUNCTION estoque_reserva_liberar(TEXT, TEXT, TEXT) IS
  'Devolve à vitrine o estoque de uma referência cancelada. Idempotente.';


-- ============================================================
-- 3. O pedido nasce — e a reserva com ele
--
-- Devolve JSONB em vez de estourar exceção quando o problema é do cliente
-- (item sem saldo, produto despublicado): a vitrine precisa MOSTRAR o que
-- houve, item a item, e não uma tela de erro. Exceção fica para o que é
-- defeito nosso.
-- ============================================================

CREATE OR REPLACE FUNCTION loja_criar_pedido(
  p_loja_id    UUID,
  p_itens      JSONB,   -- [{"produto_id": "...", "quantidade": 2}]
  p_cliente    JSONB,   -- {"nome","telefone","doc","email"}
  p_entrega    JSONB,   -- {"modo":"entrega|retirada","cep","logradouro","numero","complemento","bairro","cidade","uf"}
  p_pagamento  TEXT,
  p_observacao TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_loja        RECORD;
  v_cliente_id  UUID;
  v_pedido_id   UUID;
  v_numero      TEXT;
  v_modo        TEXT;
  v_total       NUMERIC := 0;
  v_recusados   JSONB   := '[]'::JSONB;
  v_pid         UUID;
  v_item        RECORD;
  v_doc         TEXT;
  v_fone        TEXT;
BEGIN
  SELECT c.id, c.empresa_id, c.canal_id, c.ativo, c.em_manutencao,
         c.reserva_minutos, c.permitir_venda_sem_estoque,
         c.limite_maximo_por_compra, c.pedido_prefixo,
         c.entrega_ativa, c.retirada_ativa
    INTO v_loja
    FROM loja_config c WHERE c.id = p_loja_id;

  IF v_loja.id IS NULL OR NOT v_loja.ativo OR v_loja.em_manutencao THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'loja_indisponivel');
  END IF;

  IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'carrinho_vazio');
  END IF;

  v_modo := COALESCE(p_entrega->>'modo', 'entrega');
  IF (v_modo = 'entrega'  AND NOT v_loja.entrega_ativa)
  OR (v_modo = 'retirada' AND NOT v_loja.retirada_ativa) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'modo_entrega_indisponivel');
  END IF;

  IF COALESCE(btrim(p_cliente->>'nome'), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cliente_sem_nome');
  END IF;

  -- ── Os itens pedidos, normalizados e sem repetição ────────
  -- O DROP antes do CREATE não é zelo excessivo: `ON COMMIT DROP` só limpa
  -- no commit, então duas chamadas na MESMA transação encontrariam a tabela
  -- de pé e a função morreria com "relation already exists".
  DROP TABLE IF EXISTS pedido_tmp;
  DROP TABLE IF EXISTS pedido_itens_tmp;
  DROP TABLE IF EXISTS conferido_tmp;

  CREATE TEMP TABLE pedido_tmp ON COMMIT DROP AS
  SELECT (e->>'produto_id')::UUID AS produto_id,
         GREATEST(1, floor(COALESCE((e->>'quantidade')::NUMERIC, 1))::INT) AS quantidade
    FROM jsonb_array_elements(p_itens) e
   WHERE (e->>'produto_id') IS NOT NULL;

  -- Repetido no carrinho vira uma linha só: senão a conferência de saldo
  -- olharia cada metade e as duas passariam.
  CREATE TEMP TABLE pedido_itens_tmp ON COMMIT DROP AS
  SELECT produto_id, SUM(quantidade)::INT AS quantidade
    FROM pedido_tmp GROUP BY produto_id;

  IF (SELECT count(*) FROM pedido_itens_tmp) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'carrinho_vazio');
  END IF;

  -- ── A TRAVA. Em ordem de id, para dois pedidos com os mesmos
  --    produtos nunca travarem um ao outro. ──────────────────
  FOR v_pid IN SELECT produto_id FROM pedido_itens_tmp ORDER BY produto_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_pid::TEXT, 0));
  END LOOP;

  -- ── Preço e disponibilidade, já com a trava tomada ────────
  -- O preço vem da MESMA view que a vitrine mostrou. Cobrar de outra fonte é
  -- como uma loja vende por um preço que não pratica.
  CREATE TEMP TABLE conferido_tmp ON COMMIT DROP AS
  SELECT i.produto_id,
         i.quantidade,
         v.nome,
         v.sku,
         COALESCE(v.preco, 0)                AS preco,
         COALESCE(d.disponivel, 0)           AS disponivel,
         (v.produto_id IS NULL)              AS sumiu,
         COALESCE(v.limite_maximo_por_compra, v_loja.limite_maximo_por_compra) AS teto
    FROM pedido_itens_tmp i
    LEFT JOIN loja_vitrine_produtos v
           ON v.loja_id = p_loja_id AND v.produto_id = i.produto_id
          AND v.status = 'publicado'
    LEFT JOIN loja_estoque_disponivel(
           p_loja_id, ARRAY(SELECT produto_id FROM pedido_itens_tmp)) d
           ON d.produto_id = i.produto_id;

  -- Recusa item a item, com motivo. A vitrine mostra a lista e o cliente
  -- decide — bem melhor que "não foi possível concluir".
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'produto_id', produto_id,
           'nome',       COALESCE(nome, ''),
           'motivo',     CASE
                           WHEN sumiu THEN 'indisponivel'
                           WHEN teto IS NOT NULL AND quantidade > teto THEN 'acima_do_limite'
                           ELSE 'sem_saldo'
                         END,
           'disponivel', disponivel)), '[]'::JSONB)
    INTO v_recusados
    FROM conferido_tmp
   WHERE sumiu
      OR (teto IS NOT NULL AND quantidade > teto)
      OR (NOT v_loja.permitir_venda_sem_estoque AND quantidade > disponivel);

  IF jsonb_array_length(v_recusados) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'itens_indisponiveis',
                              'itens', v_recusados);
  END IF;

  SELECT SUM(preco * quantidade) INTO v_total FROM conferido_tmp;

  -- ── O cliente. NUNCA um cadastro paralelo: `clientes` é o
  --    cadastro único do ERP, e é nele que o balcão vai achar
  --    esta pessoa depois. ─────────────────────────────────
  v_doc  := NULLIF(regexp_replace(COALESCE(p_cliente->>'doc', ''),   '\D', '', 'g'), '');
  v_fone := NULLIF(regexp_replace(COALESCE(p_cliente->>'telefone',''), '\D', '', 'g'), '');

  IF v_doc IS NOT NULL THEN
    SELECT id INTO v_cliente_id FROM clientes
     WHERE empresa_id = v_loja.empresa_id
       AND regexp_replace(COALESCE(cpf_cnpj,''), '\D', '', 'g') = v_doc
     LIMIT 1;
  END IF;

  IF v_cliente_id IS NULL AND v_fone IS NOT NULL THEN
    SELECT id INTO v_cliente_id FROM clientes
     WHERE empresa_id = v_loja.empresa_id
       AND regexp_replace(COALESCE(telefone,''), '\D', '', 'g') = v_fone
     LIMIT 1;
  END IF;

  IF v_cliente_id IS NULL THEN
    INSERT INTO clientes (empresa_id, nome, cpf_cnpj, telefone, email,
                          cep, logradouro, numero, bairro, cidade, estado, ativo)
    VALUES (v_loja.empresa_id, btrim(p_cliente->>'nome'), v_doc, v_fone,
            NULLIF(btrim(COALESCE(p_cliente->>'email','')), ''),
            NULLIF(p_entrega->>'cep',''),        NULLIF(p_entrega->>'logradouro',''),
            NULLIF(p_entrega->>'numero',''),     NULLIF(p_entrega->>'bairro',''),
            NULLIF(p_entrega->>'cidade',''),     NULLIF(p_entrega->>'uf',''), true)
    RETURNING id INTO v_cliente_id;
  END IF;

  -- ── O pedido ──────────────────────────────────────────────
  v_numero := v_loja.pedido_prefixo || '-' ||
              lpad(nextval('loja_pedido_numero_seq')::TEXT, 6, '0');

  INSERT INTO marketplace_pedidos (
    empresa_id, canal_id, id_externo, numero_pedido,
    cliente_nome, cliente_email, cliente_doc,
    entrega_cep, entrega_logradouro, entrega_numero,
    entrega_bairro, entrega_cidade, entrega_estado,
    valor_produtos, valor_frete, valor_desconto, valor_total,
    status, status_externo, data_pedido, observacoes,
    etapa_interna, etapa_operacional, dados_brutos
  ) VALUES (
    v_loja.empresa_id, v_loja.canal_id, v_numero, v_numero,
    btrim(p_cliente->>'nome'),
    NULLIF(btrim(COALESCE(p_cliente->>'email','')), ''), v_doc,
    NULLIF(p_entrega->>'cep',''),    NULLIF(p_entrega->>'logradouro',''),
    NULLIF(p_entrega->>'numero',''), NULLIF(p_entrega->>'bairro',''),
    NULLIF(p_entrega->>'cidade',''), NULLIF(p_entrega->>'uf',''),
    v_total, 0, 0, v_total,
    'novo', v_modo, now(), NULLIF(btrim(COALESCE(p_observacao,'')), ''),
    'novo', 'novo',
    -- O que não tem coluna própria fica aqui, e não inventa coluna em tabela
    -- que os marketplaces também usam.
    jsonb_build_object(
      'origem', 'loja_online', 'loja_id', p_loja_id,
      'modo_entrega', v_modo, 'pagamento_forma', p_pagamento,
      'cliente_id', v_cliente_id, 'telefone', v_fone,
      'complemento', p_entrega->>'complemento')
  ) RETURNING id INTO v_pedido_id;

  INSERT INTO marketplace_pedido_itens
         (pedido_id, produto_id, nome_produto, sku, quantidade, preco_unitario, subtotal)
  SELECT v_pedido_id, produto_id, COALESCE(nome,'(sem nome)'), sku,
         quantidade, preco, preco * quantidade
    FROM conferido_tmp;

  -- ── A RESERVA. É a Fase 2 acontecendo, e ela NÃO EXPIRA. ──
  --
  -- `reserva_minutos` é prazo de CARRINHO EM ANDAMENTO — um checkout que o
  -- cliente pode abandonar. Aqui o pedido já nasce CONFIRMADO, e o esquema da
  -- Fase 1 já dizia qual era o certo: "expira_em NULL = reserva sem prazo
  -- (pedido confirmado à espera de separação)".
  --
  -- Com prazo acontecia isto: pedido entra, reserva segura 30 min, expira, o
  -- estoque volta à vitrine — e o pedido continua aberto, com a mercadoria
  -- prometida a alguém. A loja revendia o que já tinha vendido.
  --
  -- A válvula deixa de ser o relógio e passa a ser o ciclo do pedido:
  -- CONSUMIDA quando o estoque baixa (etapa 'separando') e LIBERADA quando o
  -- pedido é cancelado. Ver src/lib/pedidos/reservaLoja.ts.
  INSERT INTO estoque_reservas
         (empresa_id, produto_id, canal_id, quantidade,
          referencia_tipo, referencia_id, status, expira_em, observacao)
  SELECT v_loja.empresa_id, produto_id, v_loja.canal_id, quantidade,
         'loja_pedido', v_pedido_id::TEXT, 'ativa',
         NULL,
         'Pedido ' || v_numero
    FROM conferido_tmp;

  RETURN jsonb_build_object(
    'ok', true, 'pedido_id', v_pedido_id, 'numero', v_numero,
    'total', v_total, 'cliente_id', v_cliente_id);
END;
$$;

COMMENT ON FUNCTION loja_criar_pedido(UUID, JSONB, JSONB, JSONB, TEXT, TEXT) IS
  'Cria o pedido da loja e a reserva de estoque na MESMA transação. Trava por produto para não vender a última unidade duas vezes.';


-- ============================================================
-- 4. Privilégios
--
-- NADA para `anon`. Quem chama é o servidor da vitrine, com chave de
-- serviço — o navegador do consumidor não fala com o banco, e é isso que
-- mantém a regra que governa a Loja Online desde a Fase 1.
-- ============================================================

REVOKE ALL ON FUNCTION loja_criar_pedido(UUID, JSONB, JSONB, JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION estoque_reserva_consumir(TEXT, TEXT)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION estoque_reserva_liberar(TEXT, TEXT, TEXT)   FROM PUBLIC, anon;

-- O painel do ERP precisa liberar e consumir reserva ao mexer no pedido.
GRANT EXECUTE ON FUNCTION estoque_reserva_consumir(TEXT, TEXT)      TO authenticated;
GRANT EXECUTE ON FUNCTION estoque_reserva_liberar(TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON SEQUENCE loja_pedido_numero_seq FROM PUBLIC, anon;


-- ============================================================
-- CONFERÊNCIA
--
--   -- nada disto pode estar ao alcance do anônimo:
--   SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE')
--     FROM pg_proc p
--    WHERE p.proname IN ('loja_criar_pedido','estoque_reserva_consumir',
--                        'estoque_reserva_liberar');
--   -- esperado: false nas três
--
--   -- depois do primeiro pedido de verdade:
--   SELECT numero_pedido, cliente_nome, valor_total, status, etapa_interna
--     FROM marketplace_pedidos
--    WHERE dados_brutos->>'origem' = 'loja_online'
--    ORDER BY created_at DESC LIMIT 5;
--
--   -- e a reserva que nasceu junto (a Fase 2 saindo do zero):
--   SELECT r.referencia_id, r.produto_id, r.quantidade, r.status, r.expira_em
--     FROM estoque_reservas r WHERE r.referencia_tipo = 'loja_pedido'
--    ORDER BY r.criado_em DESC LIMIT 10;
--
--   -- e o efeito dela na vitrine: `reservado` deixa de ser zero.
--   SELECT * FROM loja_estoque_disponivel('<loja_id>',
--     ARRAY(SELECT produto_id FROM estoque_reservas
--            WHERE referencia_tipo='loja_pedido' AND status='ativa' LIMIT 5));
-- ============================================================

-- ============================================================
-- COMO DESFAZER
--   DROP FUNCTION IF EXISTS loja_criar_pedido(UUID, JSONB, JSONB, JSONB, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS estoque_reserva_consumir(TEXT, TEXT);
--   DROP FUNCTION IF EXISTS estoque_reserva_liberar(TEXT, TEXT, TEXT);
--   DROP SEQUENCE IF EXISTS loja_pedido_numero_seq;
--   ALTER TABLE loja_config DROP COLUMN IF EXISTS pagamento_formas,
--                           DROP COLUMN IF EXISTS pedido_prefixo;
--
-- Pedidos já criados NÃO são apagados por isto — são linhas de
-- `marketplace_pedidos` como as dos outros canais, e se apagam por lá.
-- ============================================================
