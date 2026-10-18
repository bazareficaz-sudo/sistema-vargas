-- Recebimento em lote: transacional e idempotente.
--
-- O DEFEITO QUE ISTO CORRIGE
--
-- `ReceberEmMassaModal` percorre as contas gravando uma a uma, sem
-- transação: `insert recebimentos` + `update contas_receber`, em laço. Se
-- falha no meio, as primeiras já foram gravadas, o modal mostra o erro e
-- fica aberto com a seleção intacta — e o reenvio grava de novo as que já
-- tinham entrado.
--
-- Medido em produção: 29 pares duplicados, 38 lançamentos excedentes,
-- R$ 2.175,73. Vinte e seis deles em rajadas de até 5 segundos, com
-- duplicatas e triplicatas do mesmo lote — a assinatura de reenvio sobre
-- escrita parcial. (Os outros 3, separados por mais de uma hora, são o
-- defeito do PDV que a 1.10.6 corrigiu.)
--
-- Clique duplo NÃO é a causa: a trava síncrona existe desde 24/09 e está
-- publicada. O que faltava era atomicidade.

-- 1. A IDENTIDADE DO LOTE
--
-- Nullable: os recebimentos históricos não têm lote e continuam válidos. O
-- índice é parcial pelo mesmo motivo.
--
-- É a mesma forma que resolveu venda (pdv_venda_sync), transferência
-- (UNIQUE transferencia_id, caixa_id) e sessão: identidade vinda da origem
-- mais uma trava de banco. Nunca convenção de aplicação.
ALTER TABLE recebimentos ADD COLUMN IF NOT EXISTS lote_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_recebimentos_lote_conta
  ON recebimentos (lote_id, conta_id)
  WHERE lote_id IS NOT NULL;

-- 2. A RPC
CREATE OR REPLACE FUNCTION public.receber_contas_em_lote_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_lote      uuid;
  v_item      jsonb;
  v_conta     contas_receber%ROWTYPE;
  v_conta_id  uuid;
  v_valor     numeric;
  v_juros     numeric;
  v_multa     numeric;
  v_desc      numeric;
  v_novo_rec  numeric;
  v_aberto    numeric;
  v_status    text;
  v_rec_id    uuid;
  v_aplicados int := 0;
  v_pulados   int := 0;
  v_total     numeric := 0;
BEGIN
  BEGIN
    v_lote := (p_payload->>'lote_id')::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','lote_id ausente ou malformado');
  END;
  IF v_lote IS NULL THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','lote_id ausente ou malformado');
  END IF;

  IF jsonb_typeof(coalesce(p_payload->'contas','[]'::jsonb)) <> 'array'
     OR jsonb_array_length(coalesce(p_payload->'contas','[]'::jsonb)) = 0 THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','contas deve ser um array nao vazio');
  END IF;

  -- Serializa por lote: dois envios simultâneos do mesmo lote não disputam.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_lote::text, 0));

  -- ── PASSO 1: conferir TUDO antes de gravar QUALQUER COISA ──
  --
  -- Recusa o lote inteiro, não metade. Uma conta cancelada ou já quitada na
  -- seleção é sinal de lista desatualizada: o certo é o operador reler, não
  -- o sistema receber por cima.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'contas')
  LOOP
    BEGIN
      v_conta_id := (v_item->>'conta_id')::uuid;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('estado','payload_invalido','motivo','conta_id malformado');
    END;

    SELECT * INTO v_conta FROM contas_receber WHERE id = v_conta_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('estado','conta_nao_encontrada','conta_id',v_conta_id);
    END IF;

    IF v_conta.status IN ('cancelado','recebido') THEN
      -- Já aplicado neste mesmo lote não é divergência: é retry.
      IF EXISTS (SELECT 1 FROM recebimentos r
                  WHERE r.lote_id = v_lote AND r.conta_id = v_conta_id) THEN
        CONTINUE;
      END IF;
      RETURN jsonb_build_object('estado','conta_indisponivel','conta_id',v_conta_id,
        'status', v_conta.status,
        'motivo','a conta ja foi quitada ou cancelada; releia a lista antes de receber');
    END IF;

    v_valor := round(coalesce((v_item->>'valor')::numeric, 0), 2);
    IF v_valor <= 0 THEN
      RETURN jsonb_build_object('estado','payload_invalido','conta_id',v_conta_id,
        'motivo','valor deve ser maior que zero');
    END IF;

    -- Nunca deixar valor_aberto negativo. Hoje não existe nenhuma linha
    -- assim em produção, e não é por aqui que vai nascer a primeira.
    IF round(coalesce(v_conta.valor_recebido,0) + v_valor, 2) > round(v_conta.valor_original, 2) THEN
      RETURN jsonb_build_object('estado','valor_excede_a_conta','conta_id',v_conta_id,
        'valor_original', v_conta.valor_original,
        'ja_recebido', v_conta.valor_recebido,
        'valor_recebido_agora', v_valor);
    END IF;
  END LOOP;

  -- ── PASSO 2: gravar ──
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'contas')
  LOOP
    v_conta_id := (v_item->>'conta_id')::uuid;
    SELECT * INTO v_conta FROM contas_receber WHERE id = v_conta_id;

    v_valor := round(coalesce((v_item->>'valor')::numeric, 0), 2);
    v_juros := round(coalesce((v_item->>'juros')::numeric, 0), 2);
    v_multa := round(coalesce((v_item->>'multa')::numeric, 0), 2);
    v_desc  := round(coalesce((v_item->>'desconto')::numeric, 0), 2);

    -- A trava real. Reenvio do MESMO lote não grava de novo: o índice
    -- único recusa e o RETURNING vem vazio.
    INSERT INTO recebimentos (
      lote_id, empresa_id, conta_id, cliente_id, valor, desconto, juros, multa,
      valor_liquido, forma_pagamento, conta_destino, observacao, operador_nome,
      data_recebimento
    ) VALUES (
      v_lote, v_conta.empresa_id, v_conta_id, v_conta.cliente_id,
      v_valor, v_desc, v_juros, v_multa,
      round(v_valor - v_desc + v_juros + v_multa, 2),
      coalesce(nullif(v_item->>'forma_pagamento',''), 'dinheiro'),
      nullif(v_item->>'conta_destino',''),
      nullif(v_item->>'observacao',''),
      nullif(v_item->>'operador_nome',''),
      coalesce(nullif(v_item->>'data_recebimento','')::date, current_date)
    )
    ON CONFLICT (lote_id, conta_id) WHERE lote_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_rec_id;

    IF v_rec_id IS NULL THEN
      -- Já estava aplicado neste lote. A conta NÃO é tocada de novo.
      v_pulados := v_pulados + 1;
      CONTINUE;
    END IF;

    -- O valor novo vem do BANCO, não de uma cópia que a tela carregou
    -- antes. Era essa leitura velha que fazia dois recebimentos
    -- simultâneos perderem um.
    v_novo_rec := round(coalesce(v_conta.valor_recebido,0) + v_valor, 2);
    v_aberto   := round(v_conta.valor_original - v_novo_rec, 2);
    v_status   := CASE WHEN v_aberto <= 0.01 THEN 'recebido' ELSE 'parcial' END;

    -- `clientes.saldo_devedor` NÃO é escrito aqui: este UPDATE dispara
    -- `z_trg_sincronizar_saldo_devedor`, que recalcula a projeção sozinho.
    -- Escrever à mão seria o segundo escritor que a 4C.1.1 eliminou.
    UPDATE contas_receber
       SET valor_recebido = v_novo_rec,
           juros    = coalesce(juros,0)    + v_juros,
           multa    = coalesce(multa,0)    + v_multa,
           desconto = coalesce(desconto,0) + v_desc,
           status   = v_status,
           updated_at = now()
     WHERE id = v_conta_id;

    v_aplicados := v_aplicados + 1;
    v_total := v_total + v_valor;
  END LOOP;

  RETURN jsonb_build_object('estado','aplicado','lote_id',v_lote,
    'aplicados', v_aplicados, 'ja_aplicados', v_pulados,
    'valor_total', round(v_total,2));
END;
$fn$;
