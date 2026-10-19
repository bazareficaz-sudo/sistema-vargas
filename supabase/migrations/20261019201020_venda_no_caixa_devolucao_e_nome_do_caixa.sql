-- Dois acertos na 4E, achados pelo teste de aceitação.
--
-- ── 1. "Caixa Caixa" ──────────────────────────────────────────────────────
--
-- A criação dos caixas de terminal usou 'Caixa ' || t.nome. O terminal do
-- caixa se chama literalmente "Caixa", e saiu "Caixa Caixa".
UPDATE caixa SET nome = 'Caixa', updated_at = now()
 WHERE nome = 'Caixa Caixa' AND tipo = 'pdv';

-- ── 2. A DEVOLUÇÃO NÃO LANÇA, E O MOTIVO MENTIA ──────────────────────────
--
-- O teste inseriu uma devolução (`forma_pagamento = 'devolucao'`, total
-- negativo) e nada foi lançado. A causa: 'devolucao' não é uma forma do
-- cadastro, então não há caixa de destino — e a view diria
-- 'forma "devolucao" nao esta no cadastro de formas', que é verdade e não
-- ajuda ninguém.
--
-- O problema de fundo é que o dado não existe: a linha de devolução em
-- `vendas` grava 'devolucao' NO LUGAR da forma original, então o sistema não
-- sabe se o dinheiro voltou da gaveta, do pix ou da maquininha. Sem isso,
-- qualquer caixa que eu escolhesse seria chute — e chute no ledger é pior que
-- lacuna, porque some do relatório de pendências.
--
-- São 29 devoluções em 60 dias, R$ 599,15. Enquanto não lançarem, o saldo dos
-- caixas fica SUPERESTIMADO nesse valor, e a view é que diz isso em voz alta.
--
-- O caminho de saída, para quando houver decisão: `vendas` passar a guardar a
-- forma original da devolução (ou o id da venda devolvida). Aí a natureza
-- 'estorno_venda', que já está no CHECK e já está escrita na função, começa a
-- ser usada sem mudar mais nada.
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
      -- O motivo verdadeiro, no lugar de "forma nao cadastrada".
      WHEN (SELECT forma_pagamento FROM v) = 'devolucao' THEN
        'devolucao: a linha grava "devolucao" no lugar da forma original, '
        'entao nao se sabe de qual caixa o dinheiro voltou. O saldo fica '
        'superestimado neste valor ate a forma original ser gravada.'
      WHEN (SELECT forma_pagamento FROM v) = 'misto' THEN
        'pagamento dividido: a divisao nao fica gravada enquanto o protocolo v2 estiver desligado'
      WHEN (SELECT count(*) FROM f) = 0 THEN
        'forma "' || (SELECT forma_pagamento FROM v) || '" nao esta no cadastro de formas'
      WHEN (SELECT liquidacao FROM f) = 'fiado' THEN 'fiado: o titulo vive em contas a receber'
      WHEN (SELECT liquidacao FROM f) = 'adquirente'
       AND (SELECT adquirente_caixa_id FROM f) IS NULL THEN 'forma sem adquirente definida'
      WHEN (SELECT caixa_destino_id FROM f) IS NULL
       AND (SELECT id FROM caixa_do_terminal) IS NULL THEN
        'dinheiro sem gaveta: o terminal "' || COALESCE((SELECT terminal_id FROM v), '(sem terminal)') ||
        '" nao tem caixa, por nao estar cadastrado ou estar revogado'
      ELSE NULL
    END;
$$;

COMMENT ON FUNCTION caixa_destino_da_venda_v1 IS
  'Onde a venda entra no ledger. caixa_id nulo = nao lancar, e `motivo` diz por que, com a causa de fundo e nao com o sintoma. Resolve terminal pelo codigo legado, considerando so terminal ativo -- e isso vale apenas para dinheiro: cartao e pix vao para a adquirente e para o banco, que nao dependem do terminal.';
