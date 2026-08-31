-- ============================================================
-- UNIFICAR OS CLIENTES COM DINHEIRO PARTIDO — 31/08/2026
--
-- Reportado do Contas a Receber: o filtro de clientes lista o mesmo nome duas
-- e três vezes. São cadastros separados de verdade, criados por uma importação
-- do sistema legado que roda de novo e recria em vez de casar. Os lotes são
-- visíveis no `created_at` (timestamps idênticos ao microssegundo):
--
--   30/06 20:03:18 → 22    26/07 01:00 → 19    07/08 22:05 → 8
--   23/08 22:04    →  6    24/08 13:16 → 33
--
-- E o de 07/08 tem um vizinho revelador: "TESTE BASE44 LEGADO", criado às
-- 21:57, oito minutos antes.
--
-- ESTE ARQUIVO NÃO CONSERTA A IMPORTAÇÃO — ela não está neste repositório.
-- Ele conserta os quatro casos em que a dívida do MESMO cliente está partida
-- entre duas fichas, que é onde o problema vira dinheiro errado na tela.
--
-- O QUE NÃO ESTÁ AQUI, DE PROPÓSITO: os outros ~40 duplicados sem conta
-- nenhuma. Eles sujam a lista e não movem valor; unificá-los é limpeza, e
-- limpeza não entra no mesmo passo que dinheiro.
--
-- ── ORDEM DAS COISAS ────────────────────────────────────────
--
-- 1. reaponta as referências do perdedor para o vencedor
-- 2. marca o perdedor com `mesclado_em` (nunca apaga — mesmo padrão de
--    supabase-cliente-mesclado-redirecionar.sql e de unificar-produtos)
-- 3. recalcula o `saldo_devedor` do vencedor pela SOMA REAL das contas
--
-- O passo 3 não é zelo: em dois dos quatro o saldo gravado já não batia com
-- as contas antes de qualquer unificação —
--   ESCRITORIO  saldo 2.797,11  ·  contas em aberto 2.713,76  (83,35 de sobra)
--   INDIO       saldo   204,30  ·  contas em aberto   183,10  (21,20 de sobra)
-- Somar as duas fichas sem recalcular carregaria a diferença adiante.
--
-- Os ids estão escritos à mão, um a um. Nada de casar por nome em tempo de
-- execução: o que roda é exatamente o que foi revisado.
--
-- EXECUTADO EM 31/08/2026. Resultado conferido, bateu com o previsto:
--   ESCRITORIO ROCHA RANGEL   R$ 2.732,52 · 67 contas · 48 abertas · 2 fichas
--   NELSON ROQUE GERENTE **   R$   544,38 · 31 contas · 13 abertas · 3 fichas
--   INDIO (CONCERTA GELADEIRA) R$  184,80 ·  9 contas ·  9 abertas · 2 fichas
--   DIRCEU RA CAIRO **        R$    73,00 ·  4 contas ·  3 abertas · 2 fichas
--
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- TUDO NUM BLOCO SO, e nao em statements soltos: assim ou a uniao inteira
-- acontece ou nada acontece. Rodar por partes deixaria contas reapontadas para
-- um cliente que nao foi marcado como vencedor, que e pior que o problema.
DO $unir$
DECLARE
  pares CONSTANT UUID[][] := ARRAY[
    -- vencedor (ficha de 30/06, com telefone e historico)  |  perdedor
    -- ESCRITORIO CONTABILIDADE ROCHA RANGEL — 66 contas, R$ 2.713,76
    ['a188415c-5cd1-4c1a-9514-3045e1e8f8d0','91ab138e-c639-4d71-b9f2-e14b081459e1'],
    -- NELSON ROQUE GERENTE ** — 30 contas, R$ 422,40
    ['b2d17f15-b035-4116-8f84-f02af7a188d4','876b49c9-0410-4768-a91e-9450cbde1491'],
    ['b2d17f15-b035-4116-8f84-f02af7a188d4','d8a2fb5c-5d1c-4eaa-b19f-5c62bf733b45'],
    -- INDIO (CONCERTA GELADEIRA) — 8 contas, R$ 183,10
    ['3fa0b5fd-34f7-4a31-a8c9-b5392e093917','1ff1431d-f5dd-4b37-b9be-62d5aa176084'],
    -- DIRCEU RA CAIRO ** — 3 contas, R$ 55,00
    ['26ae074c-8533-4bc7-aeda-7e8a7ff1e6ad','81b2f6dc-ee96-4388-a5f6-27176254ca47'],
    ['26ae074c-8533-4bc7-aeda-7e8a7ff1e6ad','61fa67a6-84c8-4720-911d-9bdad52b81e4']
  ];
  i INT;
  venc UUID;
  perd UUID;
  n INT;
BEGIN
  FOR i IN 1 .. array_length(pares, 1) LOOP
    venc := pares[i][1];
    perd := pares[i][2];

    -- TRAVA. Um digito trocado num UUID moveria divida entre clientes
    -- diferentes sem nenhum aviso. Vencedor e perdedor tem de ser da mesma
    -- empresa, existir, e o vencedor nao pode ele mesmo estar mesclado.
    SELECT count(*) INTO n
      FROM clientes v JOIN clientes p ON p.empresa_id = v.empresa_id
     WHERE v.id = venc AND p.id = perd AND v.mesclado_em IS NULL;
    IF n <> 1 THEN
      RAISE EXCEPTION 'Par invalido: % -> %. Empresas diferentes, id inexistente ou vencedor ja mesclado.', perd, venc;
    END IF;

    -- 1. Reapontar ANTES de marcar: o gatilho de redirecionamento so age em
    --    INSERT novo, nao move o que ja esta gravado.
    UPDATE contas_receber            SET cliente_id = venc WHERE cliente_id = perd;
    UPDATE vendas                    SET cliente_id = venc WHERE cliente_id = perd;
    UPDATE recebimentos              SET cliente_id = venc WHERE cliente_id = perd;
    UPDATE renegociacoes             SET cliente_id = venc WHERE cliente_id = perd;
    UPDATE creditos_cliente          SET cliente_id = venc WHERE cliente_id = perd;
    UPDATE orcamentos                SET cliente_id = venc WHERE cliente_id = perd;
    UPDATE entregas                  SET cliente_id = venc WHERE cliente_id = perd;
    UPDATE cobranca_historico        SET cliente_id = venc WHERE cliente_id = perd;
    UPDATE cliente_contatos          SET cliente_id = venc WHERE cliente_id = perd;
    UPDATE cliente_enderecos_entrega SET cliente_id = venc WHERE cliente_id = perd;
    UPDATE automacoes                SET cliente_id = venc WHERE cliente_id = perd;
    UPDATE loja_carrinhos            SET cliente_id = venc WHERE cliente_id = perd;
    UPDATE loja_clientes_acesso      SET cliente_id = venc WHERE cliente_id = perd;

    -- 2. Marcar o perdedor. Nunca apagado — some das listas, historico intacto.
    UPDATE clientes
       SET mesclado_em = venc, mesclado_em_data = now(), ativo = false
     WHERE id = perd AND mesclado_em IS NULL;
  END LOOP;

  -- 3. Recalcular o saldo dos vencedores pela SOMA REAL das contas.
  UPDATE clientes c
     SET saldo_devedor = COALESCE((
           SELECT SUM(r.valor_aberto) FROM contas_receber r
            WHERE r.cliente_id = c.id AND r.status <> 'recebido'), 0)
   WHERE c.id IN (SELECT DISTINCT pares[i][1] FROM generate_subscripts(pares, 1) AS g(i));
END
$unir$;


-- ── Conferencia (rode depois) ───────────────────────────────
--
-- Esperado:
--   ESCRITORIO ROCHA RANGEL    67 contas · 48 abertas · R$ 2.732,52 · 2 fichas
--   NELSON ROQUE GERENTE **    31 contas · 13 abertas · R$   544,38 · 3 fichas
--   INDIO (CONCERTA GELADEIRA)  9 contas ·  9 abertas · R$   184,80 · 2 fichas
--   DIRCEU RA CAIRO **          4 contas ·  3 abertas · R$    73,00 · 2 fichas
--
-- ROCHA RANGEL e INDIO DESCEM (de 2.797,11 e 204,30). Nao e dinheiro perdido
-- na uniao: e a sobra que o `saldo_devedor` ja carregava a mais que a soma das
-- contas, antes de qualquer coisa. O recalculo a tira.
--
-- SELECT c.nome, c.saldo_devedor,
--        (SELECT count(*) FROM contas_receber r WHERE r.cliente_id = c.id) AS contas,
--        (SELECT count(*) FROM clientes p WHERE p.mesclado_em = c.id) AS fichas_absorvidas
--   FROM clientes c
--  WHERE c.id IN ('a188415c-5cd1-4c1a-9514-3045e1e8f8d0','b2d17f15-b035-4116-8f84-f02af7a188d4',
--                 '3fa0b5fd-34f7-4a31-a8c9-b5392e093917','26ae074c-8533-4bc7-aeda-7e8a7ff1e6ad')
--  ORDER BY c.nome;
