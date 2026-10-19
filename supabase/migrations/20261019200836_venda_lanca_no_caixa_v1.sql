-- Fase 4E: a venda lança no caixa sozinha.
--
-- Medido em 19/10/2026: 3.957 vendas nos últimos 60 dias, todas 'concluida'.
-- O ledger tem 15 movimentos, todos de homologação, nenhum com
-- `referencia_id`. Nenhuma venda jamais entrou.
--
-- O QUE A AUDITORIA ACHOU, E QUE MUDOU O DESENHO
--
-- 1. `venda_pagamento` ESTÁ VAZIA: zero linhas em 60 dias, o protocolo v2
--    está desligado. A forma vive em `vendas.forma_pagamento`, texto livre,
--    com um valor 'misto' que só diz que houve divisão, sem dizer em quê.
-- 2. `vendas.terminal_id` é TEXTO: PDV-003 (1.927), PDV-001 (1.183),
--    PDV-004 (417), PDV-002 (366), nulo (58), Caixa (3), PDV-010 (2),
--    YOGA (1). Casa com `pdv_terminais.terminal_id_legado`.
-- 3. SÓ O TERMINAL YOGA TEM CAIXA. Os quatro da loja não têm linha em
--    `caixa`, e por isso as 1.424 vendas em dinheiro não tinham para onde ir.
-- 4. 'PDV-002' NÃO EXISTE em `pdv_terminais`: 366 vendas apontando para um
--    terminal não cadastrado. Ficam sem lançar e aparecem na view.
-- 5. 'PDV-001' aparece em DOIS terminais, um revogado. Resolve só o ativo.
--
-- POR QUE TRIGGER
--
-- A venda chega por quatro caminhos: RPC do PDV com chave anônima, fila
-- offline que reenvia, conversão de orçamento, e a tela do web. Lançar na
-- aplicação seria lançar em quatro lugares, e o quinto caminho entraria sem
-- lançar — foi assim que o ledger ficou com 15 movimentos para 3.957 vendas.

CREATE TABLE IF NOT EXISTS caixa_lancamento_config (
  empresa_id uuid PRIMARY KEY,
  -- Venda criada a partir desta data lança. NULO desliga. Data e não
  -- booleano porque o ledger é append-only: desligar e religar não traz as
  -- vendas do meio. A data diz desde quando o saldo tem significado.
  lancar_vendas_desde date,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE caixa_lancamento_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS caixa_lancamento_config_leitura ON caixa_lancamento_config;
CREATE POLICY caixa_lancamento_config_leitura ON caixa_lancamento_config
  FOR SELECT TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

DROP POLICY IF EXISTS caixa_lancamento_config_escrita ON caixa_lancamento_config;
CREATE POLICY caixa_lancamento_config_escrita ON caixa_lancamento_config
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- O caixa que falta em cada terminal. Sem isto dinheiro não tem destino:
-- 1.424 vendas em 60 dias. Um por terminal, e não um da loja, porque a gaveta
-- é física — quem confere o Balcão 03 conta o dinheiro do Balcão 03.
-- Terminal revogado não ganha caixa: não vende mais.
INSERT INTO caixa (empresa_id, tipo, nome, terminal_id, ativo)
SELECT t.empresa_id, 'pdv', 'Caixa ' || t.nome, t.id, true
  FROM pdv_terminais t
 WHERE t.status = 'ativo'
   AND NOT EXISTS (SELECT 1 FROM caixa c WHERE c.terminal_id = t.id);

-- Onde cada venda entra. `caixa_id` nulo quer dizer "não lançar", e cada
-- motivo tem nome — é o que a view de pendências mostra.
CREATE OR REPLACE FUNCTION caixa_destino_da_venda_v1(p_venda uuid)
RETURNS TABLE (caixa_id uuid, forma_id uuid, codigo text, motivo text)
LANGUAGE sql STABLE AS $$
  WITH v AS (
    SELECT id, empresa_id, forma_pagamento, terminal_id, total, vendedor_id
      FROM vendas WHERE id = p_venda
  ),
  f AS (
    SELECT fp.* FROM forma_pagamento fp, v
     WHERE fp.empresa_id = v.empresa_id AND fp.codigo = v.forma_pagamento
  ),
  term AS (
    SELECT t.id FROM pdv_terminais t, v
     WHERE t.empresa_id = v.empresa_id
       AND t.terminal_id_legado = v.terminal_id
       AND t.status = 'ativo'
     LIMIT 1
  ),
  caixa_do_terminal AS (
    SELECT c.id FROM caixa c, term
     WHERE c.terminal_id = term.id AND c.ativo LIMIT 1
  )
  SELECT
    CASE
      WHEN (SELECT count(*) FROM f) = 0 THEN NULL
      WHEN (SELECT liquidacao FROM f) = 'fiado' THEN NULL
      WHEN (SELECT liquidacao FROM f) = 'adquirente' THEN (SELECT adquirente_caixa_id FROM f)
      ELSE COALESCE((SELECT caixa_destino_id FROM f), (SELECT id FROM caixa_do_terminal))
    END,
    (SELECT id FROM f),
    (SELECT forma_pagamento FROM v),
    CASE
      WHEN (SELECT count(*) FROM v) = 0 THEN 'venda nao encontrada'
      WHEN (SELECT forma_pagamento FROM v) IS NULL THEN 'venda sem forma de pagamento'
      WHEN (SELECT forma_pagamento FROM v) = 'misto' THEN
        'pagamento dividido: a divisao nao fica gravada enquanto o protocolo v2 estiver desligado'
      WHEN (SELECT count(*) FROM f) = 0 THEN
        'forma "' || (SELECT forma_pagamento FROM v) || '" nao esta no cadastro de formas'
      WHEN (SELECT liquidacao FROM f) = 'fiado' THEN 'fiado: o titulo vive em contas a receber'
      WHEN (SELECT liquidacao FROM f) = 'adquirente'
       AND (SELECT adquirente_caixa_id FROM f) IS NULL THEN 'forma sem adquirente definida'
      WHEN (SELECT caixa_destino_id FROM f) IS NULL
       AND (SELECT id FROM caixa_do_terminal) IS NULL THEN
        'terminal "' || COALESCE((SELECT terminal_id FROM v), '(sem terminal)') ||
        '" nao tem caixa: terminal nao cadastrado ou revogado'
      ELSE NULL
    END;
$$;

COMMENT ON FUNCTION caixa_destino_da_venda_v1 IS
  'Onde a venda entra no ledger. caixa_id nulo = nao lancar, e `motivo` diz por que. Resolve terminal pelo codigo legado, considerando so terminal ativo.';

-- O LANÇAMENTO. Dois movimentos por venda, no mesmo caixa:
--
--     venda   ENTRADA pelo valor BRUTO
--     taxa    SAÍDA   pelo custo da forma, se houver taxa
--
-- Bruto e taxa separados, e não líquido num movimento só, porque a
-- conciliação compara o bruto com o que a adquirente informa e a taxa com o
-- que ela cobrou. Lançar líquido perderia as duas pontas.
--
-- SECURITY DEFINER, E ISTO NÃO É CONVENIÊNCIA: `vendas` tem RLS DESLIGADA e
-- `anon` pode inserir — é assim que o PDV externo grava, sem sessão.
-- `caixa_movimento` é o oposto: RLS ligada, INSERT só para `authenticated`.
-- Sem definer, a trigger rodaria como `anon` em toda venda do balcão, a
-- policy recusaria, o bloco de exceção engoliria o erro, e as vendas
-- continuariam fora do caixa com um mecanismo que PARECE funcionar. Era o
-- pior resultado: o silêncio de antes, com aparência de solução.
--
-- `search_path` fixo porque função definer sem ele pode ser enganada por um
-- objeto de mesmo nome em outro esquema.
CREATE OR REPLACE FUNCTION venda_lanca_no_caixa_v1(p_venda uuid)
RETURNS integer LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v        record;
  d        record;
  v_desde  date;
  v_taxa   numeric;
  v_valor  numeric;
  v_lancados integer := 0;
BEGIN
  SELECT id, empresa_id, forma_pagamento, terminal_id, total, vendedor_id, status, created_at
    INTO v FROM vendas WHERE id = p_venda;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- Cancelada não entra. Se já tinha entrado, o estorno é lançamento próprio:
  -- apagar movimento quebraria o append-only.
  IF COALESCE(v.status, '') <> 'concluida' THEN RETURN 0; END IF;

  -- A trava de data. Sem linha de configuração, nada é lançado.
  SELECT lancar_vendas_desde INTO v_desde
    FROM caixa_lancamento_config WHERE empresa_id = v.empresa_id;
  IF v_desde IS NULL OR v.created_at::date < v_desde THEN RETURN 0; END IF;

  -- `caixa_movimento.usuario_id` é NOT NULL. Sem vendedor não há a quem
  -- atribuir, e inventar um usuário seria pior que não lançar: a venda
  -- aparece na view de pendências. São 3 em 60 dias.
  IF v.vendedor_id IS NULL THEN RETURN 0; END IF;

  SELECT * INTO d FROM caixa_destino_da_venda_v1(p_venda);
  IF d.caixa_id IS NULL THEN RETURN 0; END IF;

  v_valor := ABS(COALESCE(v.total, 0));
  IF v_valor = 0 THEN RETURN 0; END IF;

  -- ON CONFLICT DO NOTHING contra idx_caixa_movimento_origem_unica
  -- (referencia_tipo, referencia_id, natureza, caixa_id): é o que faz reenvio
  -- da fila offline e retry não duplicarem. A idempotência vem da trava do
  -- banco, nunca de conferir antes de inserir.
  INSERT INTO caixa_movimento (caixa_id, empresa_id, tipo, natureza, valor,
                               forma_pagamento, referencia_tipo, referencia_id,
                               usuario_id, observacao)
  SELECT d.caixa_id, v.empresa_id,
         CASE WHEN COALESCE(v.total,0) < 0 THEN 'saida' ELSE 'entrada' END,
         CASE WHEN COALESCE(v.total,0) < 0 THEN 'estorno_venda' ELSE 'venda' END,
         v_valor,
         -- `caixa_movimento.forma_pagamento` só aceita dinheiro, pix,
         -- transferencia, debito e credito. 'carteira' e 'fiado' não chegam
         -- aqui, e 'devolucao' não é forma de pagamento: fica nulo.
         CASE WHEN v.forma_pagamento IN ('dinheiro','pix','debito','credito')
              THEN v.forma_pagamento ELSE NULL END,
         'venda', v.id, v.vendedor_id,
         'Venda ' || left(v.id::text, 8) || ' · terminal ' || COALESCE(v.terminal_id, '?')
  ON CONFLICT DO NOTHING;

  v_lancados := v_lancados + 1;

  -- A TAXA, com a vigência DA DATA DA VENDA — não a de hoje. É para isso que
  -- a vigência existe: renegociar em novembro não muda o custo de uma venda
  -- de agosto.
  --
  -- Sempre 1x, e isto é uma LIMITAÇÃO CONHECIDA: `vendas` não tem coluna de
  -- parcelas, então o custo do parcelado fica subestimado (3,04% no lugar de
  -- 8,00% em 3x). Resolve-se ligando o protocolo v2 ou acrescentando a
  -- coluna; os dois tocam o PDV e ficam para outra fase.
  IF d.forma_id IS NOT NULL AND COALESCE(v.total,0) > 0 THEN
    SELECT (taxa_vigente_v1(d.forma_id, 1::smallint, v.created_at::date)).taxa_pct
      INTO v_taxa;

    IF COALESCE(v_taxa, 0) > 0 THEN
      INSERT INTO caixa_movimento (caixa_id, empresa_id, tipo, natureza, valor,
                                   referencia_tipo, referencia_id, usuario_id, observacao)
      SELECT d.caixa_id, v.empresa_id, 'saida', 'taxa',
             round(v_valor * v_taxa / 100, 2),
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

CREATE OR REPLACE FUNCTION venda_lanca_no_caixa_trigger_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Exceção engolida de propósito: defeito no lançamento do caixa NÃO pode
  -- derrubar o registro da venda. O balcão tem cliente na frente, e venda não
  -- gravada é prejuízo imediato; movimento não lançado aparece na view de
  -- pendências e se conserta depois.
  BEGIN
    PERFORM venda_lanca_no_caixa_v1(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'venda_lanca_no_caixa_v1 falhou para a venda %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_venda_lanca_no_caixa ON vendas;
CREATE TRIGGER trg_venda_lanca_no_caixa
  AFTER INSERT OR UPDATE OF status ON vendas
  FOR EACH ROW EXECUTE FUNCTION venda_lanca_no_caixa_trigger_v1();

-- O QUE NÃO ENTROU, E POR QUE. Contrapartida honesta do lançamento
-- automático: sem ela o ledger subestimaria em silêncio — e silêncio foi
-- exatamente o que deixou 3.957 vendas fora do caixa sem ninguém notar.
CREATE OR REPLACE VIEW venda_fora_do_caixa_v1 AS
SELECT v.id AS venda_id,
       v.empresa_id,
       v.created_at,
       v.terminal_id,
       v.forma_pagamento,
       v.total,
       CASE
         WHEN v.vendedor_id IS NULL THEN 'venda sem vendedor: nao ha a quem atribuir o lancamento'
         ELSE COALESCE(d.motivo, 'lancamento ainda nao processado')
       END AS motivo
  FROM vendas v
  LEFT JOIN LATERAL caixa_destino_da_venda_v1(v.id) d ON true
 WHERE v.status = 'concluida'
   AND EXISTS (SELECT 1 FROM caixa_lancamento_config k
                WHERE k.empresa_id = v.empresa_id
                  AND k.lancar_vendas_desde IS NOT NULL
                  AND v.created_at::date >= k.lancar_vendas_desde)
   AND NOT EXISTS (SELECT 1 FROM caixa_movimento m
                    WHERE m.referencia_tipo = 'venda' AND m.referencia_id = v.id)
   -- O FILTRO DE EMPRESA, À MÃO. `vendas` não tem RLS — medido em 19/10/2026
   -- —, então não há política para o `security_invoker` abaixo aplicar: sem
   -- esta linha a view devolveria venda de qualquer empresa a qualquer
   -- usuário. As duas coisas são necessárias, e nenhuma basta sozinha.
   AND (empresa_do_meu_grupo(v.empresa_id) OR is_system_admin());

-- Para `empresa_do_meu_grupo` e `is_system_admin` enxergarem QUEM PERGUNTOU,
-- e não o dono da view. É o padrão que as outras views deste projeto já usam.
ALTER VIEW venda_fora_do_caixa_v1 SET (security_invoker = true);

COMMENT ON VIEW venda_fora_do_caixa_v1 IS
  'Vendas que deveriam ter lancado no caixa e nao lancaram, com o motivo. Fiado e carteira NAO aparecem como erro: o titulo vive em contas_receber e o motivo diz isso.';

-- LIGANDO, A PARTIR DE 20/10/2026. Data escolhida pelo dono da loja em
-- 19/10/2026: começa amanhã, para o saldo nascer limpo e o primeiro dia
-- inteiro poder ser conferido contra a maquininha.
--
-- As vendas de hoje para trás NÃO entram, de propósito: o Mercado Pago já
-- liquidou a maior parte, e lançá-las sem as liquidações diria que a
-- maquininha deve o que já caiu na conta.
INSERT INTO caixa_lancamento_config (empresa_id, lancar_vendas_desde, observacao)
SELECT 'a1000000-0000-0000-0000-000000000001'::uuid, '2026-10-20'::date,
       'Fase 4E ligada em 19/10/2026, valendo de 20/10. Sem retroatividade: as 2.334 vendas de cartao e pix dos 60 dias anteriores ja foram liquidadas pelo Mercado Pago, e lanca-las sem as liquidacoes faria o saldo da adquirente afirmar uma divida que nao existe.'
 WHERE NOT EXISTS (
   SELECT 1 FROM caixa_lancamento_config
    WHERE empresa_id = 'a1000000-0000-0000-0000-000000000001'::uuid);
