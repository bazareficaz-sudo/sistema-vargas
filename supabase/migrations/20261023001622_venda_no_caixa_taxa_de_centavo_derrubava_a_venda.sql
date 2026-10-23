-- A taxa que arredondava para zero derrubava a venda inteira.
--
-- ── O DEFEITO, MEDIDO ────────────────────────────────────────────────────
--
-- Em 22/10/2026, com tres dias de lancamento automatico ligado: 271 vendas,
-- 254 lancadas. Das 17 de fora, 14 eram esperadas (carteira vai para
-- contas_receber, devolucao e misto sao lacunas conhecidas). As outras TRES
-- eram pix de R$ 0,90, R$ 1,00 e R$ 0,96, sem motivo nenhum.
--
-- A causa: numa venda de R$ 0,90 no pix, a taxa de 0,49% da R$ 0,0044, que
-- arredondado vira R$ 0,00. E `caixa_movimento` tem CHECK (valor > 0).
--
-- O INSERT da taxa era recusado, a excecao subia, e -- por os dois
-- movimentos estarem na MESMA funcao -- a entrada da venda era desfeita
-- junto. O bloco EXCEPTION do trigger engolia o erro com um RAISE WARNING
-- que ninguem le, e a venda sumia do caixa sem aparecer na view de
-- pendencias (o `motivo` vinha nulo, porque o destino existia).
--
-- A condicao que eu escrevi testava a ALIQUOTA (`v_taxa > 0`, e 0,49 e maior
-- que zero), nao o VALOR CALCULADO. Era ai que precisava olhar.
--
-- ── O ESTRAGO QUE IMPORTA NAO E O VALOR ──────────────────────────────────
--
-- Sao R$ 2,86 em tres dias. O que importa e que existia uma classe de venda
-- que sumia do caixa EM SILENCIO -- e o silencio e exatamente o que o
-- lancamento automatico existe para acabar. Hoje sao vendas de um real;
-- amanha seria qualquer caso em que a taxa arredonde para zero.
--
-- ── A CORRECAO ───────────────────────────────────────────────────────────
--
-- Calcular o valor primeiro e so lancar se ele for maior que zero. A venda
-- entra normalmente; a taxa de meio centavo nao existe -- o que e verdade,
-- porque a adquirente tambem nao cobra meio centavo.

CREATE OR REPLACE FUNCTION venda_lanca_no_caixa_v1(p_venda uuid)
RETURNS integer LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v          record;
  d          record;
  v_desde    date;
  v_taxa     numeric;
  v_valor    numeric;
  v_taxa_rs  numeric;
  v_lancados integer := 0;
BEGIN
  SELECT id, empresa_id, forma_pagamento, terminal_id, total, vendedor_id, status, created_at
    INTO v FROM vendas WHERE id = p_venda;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF COALESCE(v.status, '') <> 'concluida' THEN RETURN 0; END IF;

  SELECT lancar_vendas_desde INTO v_desde
    FROM caixa_lancamento_config WHERE empresa_id = v.empresa_id;
  IF v_desde IS NULL OR v.created_at::date < v_desde THEN RETURN 0; END IF;

  IF v.vendedor_id IS NULL THEN RETURN 0; END IF;

  SELECT * INTO d FROM caixa_destino_da_venda_v1(p_venda);
  IF d.caixa_id IS NULL THEN RETURN 0; END IF;

  v_valor := ABS(COALESCE(v.total, 0));
  IF v_valor = 0 THEN RETURN 0; END IF;

  INSERT INTO caixa_movimento (caixa_id, empresa_id, tipo, natureza, valor,
                               forma_pagamento, referencia_tipo, referencia_id,
                               usuario_id, observacao)
  SELECT d.caixa_id, v.empresa_id,
         CASE WHEN COALESCE(v.total,0) < 0 THEN 'saida' ELSE 'entrada' END,
         CASE WHEN COALESCE(v.total,0) < 0 THEN 'estorno_venda' ELSE 'venda' END,
         v_valor,
         CASE WHEN v.forma_pagamento IN ('dinheiro','pix','debito','credito')
              THEN v.forma_pagamento ELSE NULL END,
         'venda', v.id, v.vendedor_id,
         'Venda ' || left(v.id::text, 8) || ' · terminal ' || COALESCE(v.terminal_id, '?')
  ON CONFLICT DO NOTHING;

  v_lancados := v_lancados + 1;

  IF d.forma_id IS NOT NULL AND COALESCE(v.total,0) > 0 THEN
    SELECT (taxa_vigente_v1(d.forma_id, 1::smallint, v.created_at::date)).taxa_pct
      INTO v_taxa;

    -- O VALOR, calculado ANTES de decidir. A versao anterior olhava a
    -- aliquota: 0,49% e maior que zero, entao ela tentava lancar R$ 0,00 numa
    -- tabela com CHECK (valor > 0) -- e a excecao desfazia a venda junto.
    v_taxa_rs := round(v_valor * COALESCE(v_taxa, 0) / 100, 2);

    IF v_taxa_rs > 0 THEN
      INSERT INTO caixa_movimento (caixa_id, empresa_id, tipo, natureza, valor,
                                   referencia_tipo, referencia_id, usuario_id, observacao)
      SELECT d.caixa_id, v.empresa_id, 'saida', 'taxa',
             v_taxa_rs,
             'venda', v.id, v.vendedor_id,
             'Taxa de ' || to_char(v_taxa, 'FM999999.000') || '% sobre a venda '
               || left(v.id::text, 8)
      ON CONFLICT DO NOTHING;
      v_lancados := v_lancados + 1;
    END IF;
  END IF;

  RETURN v_lancados;
END;
$$;

-- As tres vendas perdidas, relancadas. A trava de origem
-- (referencia_tipo, referencia_id, natureza, caixa_id) garante que rodar isto
-- de novo nao duplica nada.
SELECT venda_lanca_no_caixa_v1(v.id)
  FROM vendas v
 WHERE v.status = 'concluida'
   AND v.created_at::date >= '2026-10-20'
   AND NOT EXISTS (SELECT 1 FROM caixa_movimento m
                    WHERE m.referencia_tipo = 'venda' AND m.referencia_id = v.id);
