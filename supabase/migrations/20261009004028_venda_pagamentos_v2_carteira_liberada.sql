-- Fase 4C.2 — Checkpoint 3, parte B (2/2): a RPC libera a carteira em v2.
--
-- A parte A recusava `carteira` em v2 porque a conta a receber não nasceria
-- — `criar_conta_carteira` lê `NEW.pagamentos` no INSERT da venda, e em v2
-- os pagamentos chegam depois. O gatilho `z_trg_venda_pagamento_carteira`
-- resolveu isso: a conta nasce do pagamento, pelo valor agregado.
--
-- Agora a recusa seca vira VERIFICAÇÃO: só é recusada a venda cuja conta já
-- foi movimentada.

-- 1. A VERIFICAÇÃO
--
-- Devolve `conflito_pagamentos`, e não um estado novo, de propósito: o
-- terminal já conhece esse estado como TERMINAL. Um estado que ele não
-- conhece seria lido como desconhecido e entraria em retry infinito.
CREATE OR REPLACE FUNCTION public.sincronizar_venda_pdv_v1_checar_carteira(
  p_venda_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tem_carteira boolean;
  v_conta        contas_receber%ROWTYPE;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(p_payload->'pagamentos','[]'::jsonb)) p
     WHERE p->>'forma' = 'carteira') INTO v_tem_carteira;

  IF NOT v_tem_carteira THEN RETURN NULL; END IF;

  SELECT * INTO v_conta FROM contas_receber
   WHERE origem = 'carteira' AND origem_id = p_venda_id;

  IF FOUND AND (v_conta.valor_recebido <> 0 OR v_conta.status IN ('cancelado','recebido')) THEN
    RETURN jsonb_build_object('estado','conflito_pagamentos','venda_id',p_venda_id,
      'motivo','a conta de carteira desta venda ja foi movimentada; a composicao nao pode ser reescrita',
      'conta_status', v_conta.status, 'conta_recebido', v_conta.valor_recebido);
  END IF;

  RETURN NULL;
END;
$fn$;

-- 2. A RPC
CREATE OR REPLACE FUNCTION public.sincronizar_venda_pdv_v1(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_venda_id     UUID;
  v_empresa_id   UUID;
  v_orcamento_id UUID;
  v_fingerprint  TEXT;
  v_fp_pag       TEXT;
  v_versao       INT;
  v_tem_pag      BOOLEAN;
  v_pag          JSONB;
  v_pag_id       UUID;
  v_chk          JSONB;
  v_existente    venda_pagamento%ROWTYPE;
  v_soma         NUMERIC := 0;
  v_reg          pdv_venda_sync%ROWTYPE;
  v_venda        vendas%ROWTYPE;
  v_item         JSONB;
  v_item_id      UUID;
  v_produto_id   UUID;
  v_deposito_id  UUID;
  v_qtd          NUMERIC;
  v_novo_saldo   NUMERIC;
  v_inserida     BOOLEAN := false;
  v_estado       TEXT;
  v_itens_n      INTEGER := 0;
  v_pag_n        INTEGER := 0;
  v_estoque_ok   BOOLEAN := false;
  v_tinha_mov    BOOLEAN;
  v_sem_estoque  JSONB := '[]'::jsonb;
BEGIN
  v_versao := coalesce((p_payload->>'schema_version')::int, 0);
  IF v_versao NOT IN (1, 2) THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','schema_version deve ser 1 ou 2');
  END IF;

  BEGIN
    v_venda_id   := (p_payload->>'venda_id')::uuid;
    v_empresa_id := (p_payload->>'empresa_id')::uuid;
    v_orcamento_id := nullif(p_payload->>'orcamento_id','')::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','venda_id/empresa_id/orcamento_id malformados');
  END;

  IF v_venda_id IS NULL OR v_empresa_id IS NULL THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','venda_id e empresa_id sao obrigatorios');
  END IF;

  IF jsonb_typeof(coalesce(p_payload->'itens','[]'::jsonb)) <> 'array' THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','itens deve ser array');
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_payload->'itens','[]'::jsonb)) i
              WHERE nullif(i->>'id','') IS NULL) THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','todo item precisa de id');
  END IF;

  -- ── VALIDAÇÃO DOS PAGAMENTOS (só v2) ────────────────────────
  v_tem_pag := jsonb_array_length(coalesce(p_payload->'pagamentos','[]'::jsonb)) > 0;

  IF v_versao = 1 AND v_tem_pag THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','pagamentos exigem schema_version 2');
  END IF;

  IF v_versao = 2 THEN
    IF jsonb_typeof(coalesce(p_payload->'pagamentos','[]'::jsonb)) <> 'array' THEN
      RETURN jsonb_build_object('estado','payload_invalido','motivo','pagamentos deve ser array');
    END IF;
    IF NOT v_tem_pag THEN
      RETURN jsonb_build_object('estado','payload_invalido','motivo','schema_version 2 exige ao menos um pagamento');
    END IF;

    FOR v_pag IN SELECT * FROM jsonb_array_elements(p_payload->'pagamentos')
    LOOP
      BEGIN
        v_pag_id := (v_pag->>'id')::uuid;
      EXCEPTION WHEN others THEN
        RETURN jsonb_build_object('estado','payload_invalido','motivo','pagamento com id ausente ou malformado');
      END;
      IF v_pag_id IS NULL THEN
        RETURN jsonb_build_object('estado','payload_invalido','motivo','pagamento com id ausente ou malformado');
      END IF;
      IF coalesce((v_pag->>'valor')::numeric, 0) <= 0 THEN
        RETURN jsonb_build_object('estado','payload_invalido','motivo','pagamento com valor nao positivo');
      END IF;

      v_soma := v_soma + round(coalesce((v_pag->>'valor')::numeric, 0), 2);
    END LOOP;

    -- A soma confere em centavos inteiros, nunca em float.
    IF round(v_soma * 100) <> round(coalesce((p_payload->>'total')::numeric,0) * 100) THEN
      RETURN jsonb_build_object('estado','payload_invalido',
        'motivo','a soma dos pagamentos nao fecha com o total da venda',
        'soma_pagamentos', v_soma, 'total', (p_payload->>'total')::numeric);
    END IF;

    -- CARTEIRA: a conta nasce do pagamento, pelo gatilho
    -- z_trg_venda_pagamento_carteira. Mas se a conta desta venda JA foi
    -- movimentada, a composicao nao pode ser reescrita — e é melhor
    -- devolver estado terminal aqui do que deixar o gatilho abortar a
    -- transacao com erro, que o terminal leria como pendente.
    v_chk := sincronizar_venda_pdv_v1_checar_carteira(v_venda_id, p_payload);
    IF v_chk IS NOT NULL THEN RETURN v_chk; END IF;

    v_fp_pag := venda_pagamentos_fingerprint_v2(p_payload);
  END IF;

  v_fingerprint := venda_fingerprint_v1(p_payload);

  PERFORM pg_advisory_xact_lock(hashtextextended(v_venda_id::text, 0));

  SELECT * INTO v_reg FROM pdv_venda_sync WHERE venda_id = v_venda_id FOR UPDATE;

  IF FOUND THEN
    IF v_reg.fingerprint IS DISTINCT FROM v_fingerprint THEN
      RETURN jsonb_build_object('estado','conflito_payload','venda_id',v_venda_id,
        'motivo','mesmo venda_id com conteudo comercial diferente',
        'fingerprint_registrado',v_reg.fingerprint,'fingerprint_recebido',v_fingerprint);
    END IF;

    IF v_reg.fingerprint_pagamentos IS NOT NULL
       AND v_reg.fingerprint_pagamentos IS DISTINCT FROM v_fp_pag THEN
      RETURN jsonb_build_object('estado','conflito_pagamentos','venda_id',v_venda_id,
        'motivo','a venda ja tem composicao de pagamentos diferente da recebida',
        'fingerprint_registrado',v_reg.fingerprint_pagamentos,'fingerprint_recebido',v_fp_pag);
    END IF;

    IF v_reg.fingerprint_pagamentos IS NOT NULL THEN
      RETURN jsonb_build_object('estado','ja_aplicada','venda_id',v_venda_id,
        'itens',v_reg.itens,'estoque_aplicado',v_reg.estoque_aplicado,'aplicado_em',v_reg.aplicado_em);
    END IF;

    IF NOT v_tem_pag THEN
      RETURN jsonb_build_object('estado','ja_aplicada','venda_id',v_venda_id,
        'itens',v_reg.itens,'estoque_aplicado',v_reg.estoque_aplicado,'aplicado_em',v_reg.aplicado_em);
    END IF;

    -- ── completada_v2 ───────────────────────────────────────────
    FOR v_pag IN SELECT * FROM jsonb_array_elements(p_payload->'pagamentos')
    LOOP
      v_pag_id := (v_pag->>'id')::uuid;
      SELECT * INTO v_existente FROM venda_pagamento WHERE id = v_pag_id;
      IF FOUND THEN
        IF v_existente.venda_id <> v_venda_id
           OR v_existente.forma <> (v_pag->>'forma')
           OR round(v_existente.valor,2) <> round((v_pag->>'valor')::numeric,2) THEN
          RETURN jsonb_build_object('estado','conflito_pagamentos','venda_id',v_venda_id,
            'motivo','pagamento com o mesmo id ja existe com conteudo diferente',
            'pagamento_id', v_pag_id);
        END IF;
        CONTINUE;
      END IF;

      INSERT INTO venda_pagamento (id, venda_id, forma, valor, valor_entregue, troco,
                                   sequencia, origem, recebido_em)
      VALUES (v_pag_id, v_venda_id, v_pag->>'forma',
              round((v_pag->>'valor')::numeric, 2),
              round(nullif(v_pag->>'valor_entregue','')::numeric, 2),
              round(nullif(v_pag->>'troco','')::numeric, 2),
              coalesce((v_pag->>'sequencia')::smallint, 1),
              'pdv_electron',
              coalesce(nullif(p_payload->>'created_at','')::timestamptz, now()));
      v_pag_n := v_pag_n + 1;
    END LOOP;

    UPDATE pdv_venda_sync
       SET fingerprint_pagamentos = v_fp_pag, schema_version = 2
     WHERE venda_id = v_venda_id;

    RETURN jsonb_build_object('estado','completada_v2','venda_id',v_venda_id,
      'pagamentos', v_pag_n, 'itens', v_reg.itens, 'estoque_aplicado', v_reg.estoque_aplicado);
  END IF;

  IF v_orcamento_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM orcamentos o
                    WHERE o.id = v_orcamento_id AND o.venda_id = v_venda_id AND o.empresa_id = v_empresa_id) THEN
      RETURN jsonb_build_object('estado','conflito_orcamento','venda_id',v_venda_id,
        'orcamento_id',v_orcamento_id,
        'motivo','orcamentos.venda_id nao confirma esta venda (ou empresa divergente)');
    END IF;
  END IF;

  SELECT * INTO v_venda FROM vendas WHERE id = v_venda_id FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO vendas (
      id, empresa_id, empresa_fiscal_id, deposito_id, numero, cliente_id, cliente_nome,
      status, tipo_operacao, subtotal, desconto, desconto_total, total, forma_pagamento,
      valor_pago, valor_recebido, troco, observacao, terminal_id, operador_nome,
      vendedor_id, vendedor_nome, vendedor_codigo, itens, orcamento_id, created_at
    ) VALUES (
      v_venda_id, v_empresa_id,
      nullif(p_payload->>'empresa_fiscal_id','')::uuid,
      nullif(p_payload->>'deposito_id','')::uuid,
      nullif(p_payload->>'numero','')::int,
      nullif(p_payload->>'cliente_id','')::uuid,
      p_payload->>'cliente_nome',
      coalesce(p_payload->>'status','concluida'), 'venda',
      round(coalesce((p_payload->>'subtotal')::numeric,0),2),
      round(coalesce((p_payload->>'desconto')::numeric,0),2),
      round(coalesce((p_payload->>'desconto')::numeric,0),2),
      round(coalesce((p_payload->>'total')::numeric,0),2),
      p_payload->>'forma_pagamento',
      round(coalesce((p_payload->>'valor_pago')::numeric,0),2),
      round(coalesce((p_payload->>'valor_pago')::numeric,0),2),
      round(coalesce((p_payload->>'troco')::numeric,0),2),
      p_payload->>'observacao',
      p_payload->>'terminal_id',
      p_payload->>'operador_nome',
      nullif(p_payload->>'vendedor_id','')::uuid,
      p_payload->>'vendedor_nome',
      p_payload->>'vendedor_codigo',
      coalesce(p_payload->'itens','[]'::jsonb),
      v_orcamento_id,
      coalesce(nullif(p_payload->>'created_at','')::timestamptz, now())
    )
    RETURNING * INTO v_venda;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('estado','conflito_payload','venda_id',v_venda_id,
        'motivo','o INSERT foi descartado por trigger BEFORE INSERT (duplicidade heuristica)');
    END IF;

    v_inserida := true;
    v_estado := 'aplicada';
  ELSE
    IF v_venda.empresa_id IS DISTINCT FROM v_empresa_id
       OR round(coalesce(v_venda.total,0),2) IS DISTINCT FROM round(coalesce((p_payload->>'total')::numeric,0),2)
       OR v_venda.orcamento_id IS DISTINCT FROM v_orcamento_id THEN
      RETURN jsonb_build_object('estado','legado_incompativel','venda_id',v_venda_id,
        'motivo','a venda ja existe no servidor e diverge do payload',
        'total_gravado',v_venda.total,'total_recebido',(p_payload->>'total')::numeric);
    END IF;
    v_estado := 'completada_de_legado';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'itens','[]'::jsonb))
  LOOP
    v_item_id := (v_item->>'id')::uuid;
    INSERT INTO venda_itens (
      id, venda_id, produto_id, produto_nome, produto_sku,
      quantidade, preco_unitario, desconto, total, tipo
    ) VALUES (
      v_item_id, v_venda_id::text, nullif(v_item->>'produto_id',''),
      v_item->>'produto_nome', nullif(v_item->>'produto_sku',''),
      round(coalesce((v_item->>'quantidade')::numeric,0),3),
      round(coalesce((v_item->>'preco_unitario')::numeric,0),2),
      round(coalesce((v_item->>'desconto')::numeric,0),2),
      round(coalesce((v_item->>'total')::numeric,0),2),
      'venda'
    )
    ON CONFLICT (id) DO NOTHING;
    v_itens_n := v_itens_n + 1;
  END LOOP;

  IF v_versao = 2 THEN
    FOR v_pag IN SELECT * FROM jsonb_array_elements(p_payload->'pagamentos')
    LOOP
      v_pag_id := (v_pag->>'id')::uuid;
      SELECT * INTO v_existente FROM venda_pagamento WHERE id = v_pag_id;
      IF FOUND THEN
        IF v_existente.venda_id <> v_venda_id
           OR v_existente.forma <> (v_pag->>'forma')
           OR round(v_existente.valor,2) <> round((v_pag->>'valor')::numeric,2) THEN
          RETURN jsonb_build_object('estado','conflito_pagamentos','venda_id',v_venda_id,
            'motivo','pagamento com o mesmo id ja existe com conteudo diferente',
            'pagamento_id', v_pag_id);
        END IF;
        CONTINUE;
      END IF;
      INSERT INTO venda_pagamento (id, venda_id, forma, valor, valor_entregue, troco,
                                   sequencia, origem, recebido_em)
      VALUES (v_pag_id, v_venda_id, v_pag->>'forma',
              round((v_pag->>'valor')::numeric, 2),
              round(nullif(v_pag->>'valor_entregue','')::numeric, 2),
              round(nullif(v_pag->>'troco','')::numeric, 2),
              coalesce((v_pag->>'sequencia')::smallint, 1),
              'pdv_electron',
              coalesce(nullif(p_payload->>'created_at','')::timestamptz, now()));
      v_pag_n := v_pag_n + 1;
    END LOOP;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM estoque_movimentacoes
     WHERE referencia_id = v_venda_id AND referencia_tipo = 'venda'
  ) INTO v_tinha_mov;

  IF v_tinha_mov THEN
    v_estoque_ok := false;
  ELSE
    v_deposito_id := nullif(p_payload->>'deposito_id','')::uuid;
    IF v_deposito_id IS NULL THEN
      SELECT id INTO v_deposito_id FROM depositos
       WHERE empresa_id = v_empresa_id AND principal = true LIMIT 1;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'itens','[]'::jsonb))
    LOOP
      v_item_id    := (v_item->>'id')::uuid;
      v_produto_id := nullif(v_item->>'produto_id','')::uuid;
      v_qtd        := round(coalesce((v_item->>'quantidade')::numeric,0),3);

      IF v_produto_id IS NULL OR v_qtd = 0 THEN
        v_sem_estoque := v_sem_estoque || jsonb_build_object('item_id',v_item_id,'motivo',
          CASE WHEN v_produto_id IS NULL THEN 'item sem produto_id' ELSE 'quantidade zero' END);
        CONTINUE;
      END IF;

      UPDATE produtos
         SET estoque = coalesce(estoque,0) - v_qtd
       WHERE id = v_produto_id
      RETURNING estoque INTO v_novo_saldo;

      IF NOT FOUND THEN
        v_sem_estoque := v_sem_estoque || jsonb_build_object('item_id',v_item_id,
          'produto_id',v_produto_id,'motivo','produto nao existe no servidor');
        CONTINUE;
      END IF;

      IF v_deposito_id IS NOT NULL THEN
        INSERT INTO produto_estoque (empresa_id, deposito_id, produto_id, quantidade, ultima_movimentacao, updated_at)
        VALUES (v_empresa_id, v_deposito_id, v_produto_id, -v_qtd, now(), now())
        ON CONFLICT (empresa_id, deposito_id, produto_id)
        DO UPDATE SET quantidade = produto_estoque.quantidade - v_qtd,
                      ultima_movimentacao = now(), updated_at = now();
      END IF;

      INSERT INTO estoque_movimentacoes (
        empresa_id, deposito_id, produto_id, produto_nome, tipo, quantidade,
        estoque_anterior, estoque_novo, referencia_id, referencia_tipo, usuario, motivo
      ) VALUES (
        v_empresa_id, v_deposito_id, v_produto_id, v_item->>'produto_nome', 'venda', v_qtd,
        v_novo_saldo + v_qtd, v_novo_saldo, v_item_id, 'venda_item',
        p_payload->>'operador_nome', 'venda ' || coalesce(p_payload->>'numero','')
      )
      ON CONFLICT (referencia_id) WHERE referencia_tipo = 'venda_item' DO NOTHING;

      v_estoque_ok := true;
    END LOOP;
  END IF;

  INSERT INTO pdv_venda_sync (venda_id, empresa_id, fingerprint, schema_version, estado,
                              itens, estoque_aplicado, fingerprint_pagamentos)
  VALUES (v_venda_id, v_empresa_id, v_fingerprint, v_versao, v_estado,
          v_itens_n, v_estoque_ok, v_fp_pag);

  RETURN jsonb_build_object('estado',v_estado,'venda_id',v_venda_id,'itens',v_itens_n,
    'pagamentos', v_pag_n,
    'estoque_aplicado',v_estoque_ok,'venda_criada_agora',v_inserida,'sem_estoque',v_sem_estoque);
END;
$function$;
