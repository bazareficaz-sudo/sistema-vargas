-- ============================================================
-- UNIFICAR OS 7 GRUPOS SEM TELEFONE — 31/08/2026
--
-- Terceira e última parte da limpeza dos duplicados que a importação do
-- sistema legado criou. As duas primeiras foram por evidência:
--
--   1. dívida partida entre fichas    → 4 grupos (dinheiro se moveu)
--   2. nome E telefone iguais         → 22 grupos (movimento zero)
--
-- Estes 7 não têm telefone em ficha nenhuma, então a regra "nome e telefone
-- batendo" não os alcança. Vão por decisão explícita, olhando ficha a ficha —
-- e é honesto dizer que aqui a evidência é mais fraca: são nomes iguais, sem
-- documento nem telefone para confirmar.
--
-- O QUE SUSTENTA A DECISÃO, mesmo sem telefone: em 6 dos 7 a ficha perdedora
-- é do lote de 24/08 13:16 e nasceu VAZIA — zero contas, zero vendas, saldo
-- zero, e assim continua. Não é um homônimo que apareceu na loja; é a
-- importação recriando um cadastro que já existia. Unificar não junta duas
-- pessoas, remove uma cópia em branco.
--
-- A EXCEÇÃO É `balcao`, e está aqui de propósito: três fichas, DUAS com
-- venda (2 vendas até 11/08 numa, 1 venda em 26/08 noutra). "balcao" não é
-- pessoa — é o consumidor sem cadastro —, então concentrar as três numa só é
-- o desejável. Mas é o único caso desta leva em que movimento muda de ficha.
--
-- Vencedora: a de maior movimento; empate, a mais antiga.
--
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

DO $unir$
DECLARE
  pares CONSTANT UUID[][] := ARRAY[
    -- balcao — vencedora 26/07 (2 vendas)
    ['dcca64ad-7668-4237-8d8a-d3d77aeafcb7','fe37ffac-a128-4927-93e1-bbd292617d1e'], -- BALCAO 24/08, vazia
    ['dcca64ad-7668-4237-8d8a-d3d77aeafcb7','23ea735f-2651-471f-9a61-a7756327405a'], -- balcao 26/08, 1 venda
    -- CASIO (PARENTE FARINHA) — vencedora 26/07 (8 contas, R$ 272,69)
    ['6d82fd24-3eaa-4154-9c64-c1b738e5cf30','b385ee4f-fefd-4727-8da0-8a13c8dd5c7e'],
    -- CHATA — ambas vazias; vencedora a mais antiga (26/07)
    ['aebbcbb5-cd76-4e63-899d-eabf74c6075c','7b3868e0-f55d-49bd-a583-7c6a4402df22'],
    -- HELIO ESMERIM ** — vencedora 30/06 (2 contas, R$ 55,20)
    ['651dc77f-9fba-4bae-9fdf-fde05e1beb0a','d3f8f5d8-f4f5-4e72-86de-031a2927bd1a'],
    -- JOEL (PENSÃO) — vencedora 26/07 (1 conta, 1 venda)
    ['7369f046-5dfe-4ea9-bf05-a6a92e8f8140','89acebd6-bf2e-4d28-a0ea-ee8d57e25b33'],
    -- LUANDER GABRIEL (JANETE) ** — vencedora 30/06 (2 contas, R$ 55,70)
    ['d46b02bb-d4a4-4571-a17b-d00ac61c00c8','dbe702a7-7caa-4d72-9607-30d8bf19ee0c'],
    -- Thainá — ambas vazias; vencedora a mais antiga (30/06)
    ['0ce9d388-bdaa-4b69-be89-b0c450c2c95b','2906bbc7-df57-4fea-bbc5-624f3370d036']
  ];
  i INT;
  venc UUID;
  perd UUID;
  n INT;
BEGIN
  FOR i IN 1 .. array_length(pares, 1) LOOP
    venc := pares[i][1];
    perd := pares[i][2];

    SELECT count(*) INTO n
      FROM clientes v JOIN clientes p ON p.empresa_id = v.empresa_id
     WHERE v.id = venc AND p.id = perd AND v.mesclado_em IS NULL;
    IF n <> 1 THEN
      RAISE EXCEPTION 'Par invalido: % -> %', perd, venc;
    END IF;

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

    UPDATE clientes
       SET mesclado_em = venc, mesclado_em_data = now(), ativo = false
     WHERE id = perd AND mesclado_em IS NULL;
  END LOOP;

  -- `balcao` recebeu venda de outra ficha; os demais não moveram nada. O
  -- recálculo roda para todos assim mesmo — é a soma real, não um ajuste.
  UPDATE clientes c
     SET saldo_devedor = COALESCE((
           SELECT SUM(x.valor_aberto) FROM contas_receber x
            WHERE x.cliente_id = c.id AND x.status <> 'recebido'), 0)
   WHERE c.id IN ('dcca64ad-7668-4237-8d8a-d3d77aeafcb7','6d82fd24-3eaa-4154-9c64-c1b738e5cf30',
                  'aebbcbb5-cd76-4e63-899d-eabf74c6075c','651dc77f-9fba-4bae-9fdf-fde05e1beb0a',
                  '7369f046-5dfe-4ea9-bf05-a6a92e8f8140','d46b02bb-d4a4-4571-a17b-d00ac61c00c8',
                  '0ce9d388-bdaa-4b69-be89-b0c450c2c95b');
END
$unir$;

-- Esperado depois: 8 fichas a menos, e ZERO nome repetido nas listas.
