-- Repõe a baixa de estoque das vendas de 30/08 08:32 a 02/09/2026.
--
-- Companheiro de supabase-corrigir-baixa-estoque-gatilho-fila.sql. Aquele
-- arquivo faz a baixa voltar a funcionar daqui pra frente; este acerta o que
-- ficou para trás. Rodar NA ORDEM: primeiro o gatilho, depois este. Ao
-- contrário, o buraco recomeça a crescer no minuto seguinte.
--
--
-- O QUE ACONTECEU, EM NÚMEROS
--
--   última baixa de venda registrada    30/08 08:28:56
--   REVOKE da Onda 2                    30/08 08:32:06   (3 minutos depois)
--
--   dia      vendas   com rastro   sem rastro
--   30/08        82            9           73
--   31/08        91            1           90
--   01/09        58            1           57
--   02/09        74            0           74
--
--   294 vendas, 526 itens, 353 produtos, 1.494,489 unidades, 1 depósito.
--
-- O terreno está limpo, e isso foi conferido antes de escrever o UPDATE:
-- nenhuma dessas vendas foi cancelada, nenhuma tem devolução, nenhum item
-- está sem produto_id, e nenhum aponta para produto que não existe mais.
-- Nada aqui precisa de exceção, e por isso não há nenhuma.
--
--
-- O CRITÉRIO, E POR QUE ELE TORNA ISTO SEGURO DE RODAR DUAS VEZES
--
-- Não se usa data para decidir o que repor: usa-se a AUSÊNCIA de rastro.
-- Entra na conta o item de venda concluída que não tem movimentação
-- apontando para a venda dele. As 9 vendas de 30/08 anteriores às 08:32
-- baixaram normalmente, têm rastro, e ficam de fora sozinhas — sem eu
-- precisar acertar o horário do corte.
--
-- A consequência é que este arquivo é idempotente por construção: depois de
-- rodar, essas vendas passam a ter movimentação, e uma segunda execução
-- seleciona zero linhas e não muda nada. Não existe caminho em que ele
-- desconte a mesma unidade duas vezes.
--
--
-- O QUE ELE GRAVA
--
--   1. estoque_movimentacoes — uma linha por item, tipo 'venda', apontando
--      para a venda de origem, com created_at do dia da venda. O extrato
--      passa a contar a história certa, e o critério acima se fecha.
--   2. produtos.estoque — desconta o total por produto.
--   3. produto_estoque.quantidade — o mesmo no par (empresa, depósito,
--      produto), criando a linha quando ela ainda não existe.
--   4. estoque_reconciliacao_20260830 — o registro permanente do que foi
--      mexido, item a item, com o saldo antes e depois. É por ele que se
--      desfaz, se for preciso.
--
-- RESSALVA HONESTA sobre estoque_anterior/estoque_novo das movimentações
-- repostas: eles são RECONSTRUÍDOS a partir do saldo de hoje, encadeados na
-- ordem cronológica das vendas, e não são o saldo que o produto tinha
-- naquele instante. Não dá para saber o saldo da época: no meio do período
-- houve ajustes manuais e vendas de marketplace, que entraram normalmente
-- (o painel web escreve com outro papel, que nunca perdeu o privilégio). O
-- que a reconstrução garante é o que importa: a soma fecha, a sequência é
-- monotônica, e a última linha de cada produto termina exatamente no saldo
-- corrigido. Cada linha diz isso de si mesma no campo observacao.
--
--
-- EFEITO COLATERAL ESPERADO
--
-- O UPDATE em produtos dispara trg_fila_produto: os 353 produtos entram em
-- marketplace_fila para reenvio aos canais. É o comportamento correto — o
-- estoque anunciado está errado desde 30/08 —, mas é bom saber antes, e não
-- descobrir pelo movimento na fila.
--
-- Saldos negativos: vários desses produtos já estão negativos hoje e ficam
-- mais negativos depois. Isso não é efeito deste arquivo; é o inventário
-- real aparecendo. Corrigir divergência de contagem é outro assunto.

-- Os quatro passos são instruções independentes, e de propósito: cada um
-- pode ser conferido antes do seguinte, e o plano (passo 2) fica gravado em
-- tabela antes de qualquer saldo ser tocado. O id da movimentação nasce no
-- plano, então o passo 3 insere com id explícito e nada precisa ser casado
-- por valor depois.

-- ── 1. Registro permanente do que esta execução vai mexer ───

CREATE TABLE IF NOT EXISTS estoque_reconciliacao_20260830 (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  executado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  venda_id              UUID NOT NULL,
  venda_criada_em       TIMESTAMPTZ NOT NULL,
  terminal_id           TEXT,
  empresa_id            UUID NOT NULL,
  deposito_id           UUID,
  produto_id            UUID NOT NULL,
  produto_nome          TEXT,
  quantidade            NUMERIC NOT NULL,
  estoque_anterior_reconstruido NUMERIC,
  estoque_novo_reconstruido     NUMERIC,
  saldo_produto_antes   NUMERIC,
  saldo_produto_depois  NUMERIC,
  movimentacao_id       UUID NOT NULL,
  aplicado_no_saldo     BOOLEAN NOT NULL DEFAULT false,
  aplicado_no_deposito  BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (venda_id, produto_id, quantidade)
);

ALTER TABLE estoque_reconciliacao_20260830 DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON estoque_reconciliacao_20260830 FROM anon;

COMMENT ON TABLE estoque_reconciliacao_20260830 IS
  'Reposição da baixa de estoque perdida entre 30/08/2026 08:32 e 02/09/2026, '
  'quando o gatilho da fila de marketplace (sem SECURITY DEFINER) abortava todo '
  'UPDATE em produtos vindo do papel anônimo. Uma linha por item reposto.';


-- ── 2. O PLANO: o que falta, em que ordem, com que saldo ────
-- Nada de saldo é tocado aqui. Grava-se a intenção inteira, conferível, e
-- só depois se mexe no estoque. acumulado_antes é a soma das reposições do
-- MESMO produto que vêm antes desta na ordem cronológica.
--
-- O UNIQUE (venda_id, produto_id, quantidade) com ON CONFLICT DO NOTHING é a
-- segunda trava contra dupla execução — a primeira é o próprio critério de
-- ausência de rastro.

INSERT INTO estoque_reconciliacao_20260830 (
  venda_id, venda_criada_em, terminal_id, empresa_id, deposito_id,
  produto_id, produto_nome, quantidade,
  estoque_anterior_reconstruido, estoque_novo_reconstruido,
  saldo_produto_antes, saldo_produto_depois, movimentacao_id
)
WITH sem_rastro AS (
  SELECT v.id, v.created_at, v.terminal_id, v.empresa_id, v.deposito_id
    FROM vendas v
   WHERE v.tipo_operacao = 'venda'
     AND v.status = 'concluida'
     AND v.created_at >= '2026-08-30 11:30:00+00'
     AND NOT EXISTS (
           SELECT 1 FROM estoque_movimentacoes m
            WHERE m.referencia_tipo = 'venda' AND m.referencia_id = v.id
         )
), itens AS (
  SELECT s.id            AS venda_id,
         s.created_at    AS venda_criada_em,
         s.terminal_id,
         s.empresa_id,
         s.deposito_id,
         i.produto_id::uuid AS produto_id,
         i.produto_nome,
         i.quantidade
    FROM sem_rastro s
    JOIN venda_itens i ON i.venda_id = s.id::text
   WHERE i.quantidade IS NOT NULL AND i.quantidade <> 0
), calculado AS (
  SELECT it.*,
         p.estoque AS saldo_hoje,
         COALESCE(SUM(it.quantidade) OVER (
           PARTITION BY it.produto_id
           ORDER BY it.venda_criada_em, it.venda_id
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS acumulado_antes,
         SUM(it.quantidade) OVER (PARTITION BY it.produto_id) AS total_produto
    FROM itens it
    JOIN produtos p ON p.id = it.produto_id
)
SELECT venda_id, venda_criada_em, terminal_id, empresa_id, deposito_id,
       produto_id, produto_nome, quantidade,
       saldo_hoje - acumulado_antes,
       saldo_hoje - acumulado_antes - quantidade,
       saldo_hoje,
       saldo_hoje - total_produto,
       gen_random_uuid()
  FROM calculado
ON CONFLICT (venda_id, produto_id, quantidade) DO NOTHING;


-- ── 3. As movimentações que faltaram ────────────────────────
-- id explícito, vindo do plano. Reexecutar não duplica: o WHERE NOT EXISTS
-- ignora o que já foi gravado.

INSERT INTO estoque_movimentacoes (
  id, empresa_id, deposito_id, produto_id, produto_nome, tipo, quantidade,
  estoque_anterior, estoque_novo, motivo, referencia_id, referencia_tipo,
  usuario, observacao, created_at
)
SELECT r.movimentacao_id, r.empresa_id, r.deposito_id, r.produto_id, r.produto_nome,
       'venda', r.quantidade,
       r.estoque_anterior_reconstruido, r.estoque_novo_reconstruido,
       'baixa não aplicada em 30/08-02/09/2026 (gatilho da fila de marketplace sem SECURITY DEFINER)',
       r.venda_id, 'venda',
       'reconciliacao',
       'Reposto em 02/09/2026. estoque_anterior/estoque_novo reconstruídos a partir do saldo atual, na ordem cronológica das vendas — não são o saldo que o produto tinha na data.',
       r.venda_criada_em
  FROM estoque_reconciliacao_20260830 r
 WHERE NOT EXISTS (SELECT 1 FROM estoque_movimentacoes m WHERE m.id = r.movimentacao_id);


-- ── 4. Saldo consolidado ────────────────────────────────────
--
-- Os passos 2 e 3 são idempotentes de graça (o critério de ausência de
-- rastro, o UNIQUE, o NOT EXISTS). Os passos 4 e 5 NÃO seriam: somam a
-- partir da tabela, e rodar duas vezes descontaria duas vezes. A trava é
-- marcar a linha na MESMA instrução que aplica o saldo — CTE que dá UPDATE e
-- devolve exatamente as linhas que acabou de marcar. Ou marca e aplica, ou
-- não faz nem uma coisa nem outra.

-- (UPDATE ... RETURNING só vale como CTE; em subquery do FROM o Postgres
-- devolve "syntax error at or near SET".)

WITH marcadas AS (
  UPDATE estoque_reconciliacao_20260830
     SET aplicado_no_saldo = true
   WHERE aplicado_no_saldo = false
  RETURNING produto_id, quantidade
), agrupado AS (
  SELECT produto_id, SUM(quantidade) AS total FROM marcadas GROUP BY produto_id
)
UPDATE produtos p
   SET estoque = p.estoque - a.total
  FROM agrupado a
 WHERE p.id = a.produto_id;


-- ── 5. Saldo por depósito ───────────────────────────────────
-- Mesma trava, marcador próprio. ON CONFLICT sobre a unique real da tabela:
-- (empresa_id, deposito_id, produto_id).

WITH marcadas AS (
  UPDATE estoque_reconciliacao_20260830
     SET aplicado_no_deposito = true
   WHERE aplicado_no_deposito = false AND deposito_id IS NOT NULL
  RETURNING empresa_id, deposito_id, produto_id, quantidade
), agrupado AS (
  SELECT empresa_id, deposito_id, produto_id, -SUM(quantidade) AS delta
    FROM marcadas GROUP BY empresa_id, deposito_id, produto_id
)
INSERT INTO produto_estoque (empresa_id, deposito_id, produto_id, quantidade)
SELECT empresa_id, deposito_id, produto_id, delta FROM agrupado
ON CONFLICT (empresa_id, deposito_id, produto_id) DO UPDATE
  SET quantidade = produto_estoque.quantidade + EXCLUDED.quantidade;


-- ============================================================
-- CONFERÊNCIA — rode logo depois
--
--   -- 1. o que foi reposto
--   SELECT count(*) AS itens, count(DISTINCT venda_id) AS vendas,
--          count(DISTINCT produto_id) AS produtos, sum(quantidade) AS unidades
--     FROM estoque_reconciliacao_20260830;
--   -- esperado: 526 itens, 294 vendas, 353 produtos, 1494.489 unidades
--
--   -- 2. não sobrou venda sem rastro no período
--   SELECT count(*) FROM vendas v
--    WHERE v.tipo_operacao='venda' AND v.status='concluida'
--      AND v.created_at >= '2026-08-30 11:30:00+00'
--      AND NOT EXISTS (SELECT 1 FROM estoque_movimentacoes m
--                       WHERE m.referencia_tipo='venda' AND m.referencia_id=v.id);
--   -- esperado: 0
--
--   -- 3. o saldo bateu com o previsto, produto a produto
--   SELECT count(*) AS divergentes
--     FROM (SELECT produto_id, max(saldo_produto_depois) AS previsto
--             FROM estoque_reconciliacao_20260830 GROUP BY produto_id) r
--     JOIN produtos p ON p.id = r.produto_id
--    WHERE p.estoque <> r.previsto;
--   -- esperado: 0  (só vale na conferência imediata; venda nova já muda o saldo)
--
--   -- 4. consolidado e por depósito contam a mesma coisa para o que foi mexido
--   SELECT count(*) AS divergentes
--     FROM (SELECT DISTINCT produto_id, deposito_id, empresa_id
--             FROM estoque_reconciliacao_20260830) r
--     JOIN produtos p ON p.id = r.produto_id
--     LEFT JOIN produto_estoque pe
--       ON pe.produto_id=r.produto_id AND pe.deposito_id=r.deposito_id AND pe.empresa_id=r.empresa_id
--    WHERE pe.quantidade IS DISTINCT FROM p.estoque;
--   -- NÃO espere 0 aqui: os dois saldos já divergiam antes de 30/08, por
--   -- causa das vendas anteriores a 03/08/2026, quando o terminal ainda não
--   -- escrevia produto_estoque. Serve para medir a divergência ANTIGA, que é
--   -- outro conserto — não para validar este arquivo.
--
--
-- COMO DESFAZER
--
--   BEGIN;
--   UPDATE produtos p SET estoque = p.estoque + t.total
--     FROM (SELECT produto_id, sum(quantidade) AS total
--             FROM estoque_reconciliacao_20260830 GROUP BY produto_id) t
--    WHERE p.id = t.produto_id;
--
--   UPDATE produto_estoque pe SET quantidade = pe.quantidade + t.total
--     FROM (SELECT empresa_id, deposito_id, produto_id, sum(quantidade) AS total
--             FROM estoque_reconciliacao_20260830 GROUP BY 1,2,3) t
--    WHERE pe.empresa_id=t.empresa_id AND pe.deposito_id=t.deposito_id AND pe.produto_id=t.produto_id;
--
--   DELETE FROM estoque_movimentacoes
--    WHERE id IN (SELECT movimentacao_id FROM estoque_reconciliacao_20260830
--                  WHERE movimentacao_id IS NOT NULL);
--
--   DROP TABLE estoque_reconciliacao_20260830;
--   COMMIT;
-- ============================================================
