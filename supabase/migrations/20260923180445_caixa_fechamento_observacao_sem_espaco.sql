-- FASE 3.1 — CORREÇÃO COSMÉTICA: O ESPAÇO À ESQUERDA NO EXTRATO.
--
-- O movimento de `diferenca_fechamento` montava a observação como
-- `coalesce(v_obs,'') || ' [falta no fechamento]'`. Sem observação
-- informada, o resultado era " [falta no fechamento]" — com um espaço
-- sobrando na frente, visível no extrato.
--
-- Só o texto muda. Nenhum dado é reescrito: o movimento já homologado
-- (sessão 84b59cd5…, 22/09 18:18) fica exatamente como está, porque o
-- ledger é append-only e reescrever o passado para deixá-lo bonito é
-- precisamente o que este módulo não faz. A correção vale para os
-- lançamentos futuros.
--
-- `CREATE OR REPLACE FUNCTION` redefine o corpo e não toca em linha
-- nenhuma das tabelas.

CREATE OR REPLACE FUNCTION fechar_caixa_sessao_v1(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sessao   UUID;
  v_empresa  UUID;
  v_usuario  UUID;
  v_contado  NUMERIC;
  v_troco    NUMERIC;
  v_obs      TEXT;
  v_transf   UUID;
  v_visto    NUMERIC;
  s          caixa_sessao%ROWTYPE;
  v_esperado NUMERIC;
  v_dif      NUMERIC;
  v_entregar NUMERIC;
  v_tes      UUID;
  v_r        JSONB;
BEGIN
  v_sessao  := nullif(p->>'sessao_id','')::UUID;
  v_empresa := nullif(p->>'empresa_id','')::UUID;
  v_usuario := nullif(p->>'usuario_id','')::UUID;
  v_contado := round(nullif(p->>'valor_contado','')::NUMERIC, 2);
  v_troco   := round(coalesce(nullif(p->>'valor_mantido_troco','')::NUMERIC, 0), 2);
  v_obs     := nullif(btrim(coalesce(p->>'observacao','')), '');
  v_transf  := nullif(p->>'transferencia_id','')::UUID;
  v_visto   := round(nullif(p->>'valor_esperado_visto','')::NUMERIC, 2);

  IF v_sessao IS NULL OR v_empresa IS NULL OR v_usuario IS NULL OR v_contado IS NULL THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','campos obrigatórios ausentes');
  END IF;
  IF v_contado < 0 OR v_troco < 0 THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','valores não podem ser negativos');
  END IF;
  IF v_troco > v_contado THEN
    RETURN jsonb_build_object('estado','payload_invalido',
      'motivo','não é possível manter mais troco do que o dinheiro contado');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('caixa_sessao:' || v_sessao::text, 0));

  SELECT * INTO s FROM caixa_sessao WHERE id = v_sessao AND empresa_id = v_empresa;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('estado','nao_encontrada','motivo','sessão não existe nesta empresa');
  END IF;
  IF s.status = 'fechada' THEN
    -- Retry do mesmo fechamento: devolve o que já foi apurado, sem
    -- transferir nada de novo.
    RETURN jsonb_build_object('estado','ja_fechada','sessao_id', v_sessao,
      'valor_esperado', s.valor_esperado, 'valor_contado', s.valor_contado,
      'diferenca', s.diferenca, 'valor_mantido_troco', s.valor_mantido_troco,
      'valor_entregue_tesouraria', s.valor_entregue_tesouraria);
  END IF;

  -- O ESPERADO É O LEDGER. Tudo que entrou e saiu daquela gaveta já está
  -- somado ali: fundo, suprimentos, sangrias — e, quando a integração
  -- vier, vendas e recebimentos em dinheiro.
  v_esperado := saldo_caixa_v1(s.caixa_id);

  -- Se a tela mostrou outro número, alguém movimentou o caixa enquanto o
  -- operador contava. Fechar com base no valor velho produziria uma
  -- diferença que não é real.
  IF v_visto IS NOT NULL AND v_visto <> v_esperado THEN
    RETURN jsonb_build_object('estado','conflito_esperado',
      'motivo','o caixa foi movimentado enquanto a conferência era feita',
      'esperado_agora', v_esperado, 'esperado_visto', v_visto);
  END IF;

  v_dif := round(v_contado - v_esperado, 2);

  -- 1. A diferença vira movimento — um FATO NOVO, nunca alteração do
  --    passado. Depois dele, o ledger diz exatamente o que foi contado.
  IF v_dif <> 0 THEN
    INSERT INTO caixa_movimento
      (caixa_id, empresa_id, tipo, natureza, valor, observacao, usuario_id, sessao_id)
    VALUES (s.caixa_id, v_empresa,
            CASE WHEN v_dif > 0 THEN 'entrada' ELSE 'saida' END,
            'diferenca_fechamento', abs(v_dif),
            -- Sem observação, o rótulo fica sozinho: `coalesce(v_obs,'')`
            -- seguido de ' [falta…]' deixava um espaço à esquerda no
            -- extrato. Com observação, o espaço separa os dois.
            CASE WHEN v_obs IS NULL THEN '' ELSE v_obs || ' ' END ||
              CASE WHEN v_dif > 0 THEN '[sobra no fechamento]' ELSE '[falta no fechamento]' END,
            v_usuario, v_sessao);
  END IF;

  -- 2. O que sai da gaveta agora é o que AINDA ESTÁ nela: contado − troco.
  --    Não se soma sangria do dia: aquele dinheiro já saiu da gaveta e já
  --    entrou na tesouraria quando a sangria foi feita. Somar de novo seria
  --    transferir duas vezes o mesmo dinheiro.
  v_entregar := round(v_contado - v_troco, 2);

  IF v_entregar > 0 THEN
    IF v_transf IS NULL THEN
      RETURN jsonb_build_object('estado','payload_invalido',
        'motivo','entrega à tesouraria exige identificador de transferência');
    END IF;
    SELECT id INTO v_tes FROM caixa WHERE empresa_id = v_empresa AND tipo = 'tesouraria';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('estado','caixa_invalido','motivo','a empresa não tem tesouraria');
    END IF;
    -- Sangria: dinheiro saindo da gaveta para a tesouraria. É exatamente o
    -- que uma sangria é, e reusar o motor mantém uma implementação só.
    v_r := transferir_caixa_v1(jsonb_build_object(
      'id', v_transf, 'empresa_id', v_empresa,
      'caixa_origem_id', s.caixa_id, 'caixa_destino_id', v_tes,
      'especie', 'sangria', 'valor', v_entregar::text,
      'observacao', coalesce(v_obs, 'Fechamento de caixa'),
      'usuario_id', v_usuario, 'sessao_id', v_sessao));
    IF v_r->>'estado' NOT IN ('aplicada','ja_aplicada') THEN
      -- Erro aqui aborta tudo: a sessão NÃO fecha com a entrega pendente.
      RETURN jsonb_build_object('estado','falha_na_entrega',
        'motivo', coalesce(v_r->>'motivo', v_r->>'estado'), 'detalhe', v_r);
    END IF;
  END IF;

  UPDATE caixa_sessao SET
    status = 'fechada', fechada_em = now(), fechada_por = v_usuario,
    valor_esperado = v_esperado, valor_contado = v_contado, diferenca = v_dif,
    valor_mantido_troco = v_troco, valor_entregue_tesouraria = v_entregar,
    fechamento_transferencia_id = CASE WHEN v_entregar > 0 THEN v_transf ELSE NULL END,
    observacao_fechamento = v_obs
  WHERE id = v_sessao;

  RETURN jsonb_build_object('estado','fechada','sessao_id', v_sessao,
    'valor_esperado', v_esperado, 'valor_contado', v_contado, 'diferenca', v_dif,
    'valor_mantido_troco', v_troco, 'valor_entregue_tesouraria', v_entregar,
    -- A prova da continuidade: o que o ledger diz que ficou na gaveta tem
    -- de ser exatamente o troco.
    'saldo_final_do_caixa', saldo_caixa_v1(s.caixa_id));
END;
$$;
