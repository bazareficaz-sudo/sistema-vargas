-- ============================================================
-- UNIFICAR CLIENTES COM NOME **E** TELEFONE IGUAIS — 31/08/2026
--
-- Segunda parte da limpeza. A primeira (supabase-unificar-clientes-
-- duplicados-20260831.sql) tratou os quatro casos em que a DÍVIDA estava
-- partida entre duas fichas. Esta trata o resto do estrago da mesma
-- importação, onde não há dinheiro envolvido.
--
-- A REGRA É A QUE FOI PEDIDA: nome e telefone, os dois batendo.
--
-- Toda ficha do nome precisa ter telefone, e todas o MESMO. Se uma estiver
-- sem, o grupo inteiro fica de fora — "vazio" não bate com nada, e tratar
-- ausência como igualdade é exatamente o que funde pessoas diferentes. Foi
-- por isso que sobraram 7 grupos (balcao, chata, CASIO, HELIO, JOEL,
-- LUANDER, Thainá): nenhuma das fichas deles tem telefone.
--
-- MOVIMENTO ZERO EM TODAS AS PERDEDORAS. Conferido antes: nenhuma das 26
-- fichas que somem tem conta a receber ou venda. Nada de dinheiro se move
-- aqui — é só tirar nome repetido da lista.
--
-- OS UUIDs ESTÃO MATERIALIZADOS, e isso é o ponto.
--
-- A primeira versão deste arquivo selecionava as linhas por uma regra em
-- tempo de execução (um GROUP BY dentro do próprio UPDATE). Funcionava, e
-- estava errada de forma: o que rodaria não seria o que foi revisado. Se um
-- cliente novo entrasse entre a revisão e a execução, ele entraria na
-- operação sem ninguém ter olhado. A regra gerou a lista; a lista é o que
-- roda.
--
-- Vencedora de cada grupo: a de maior movimento; empate, a mais antiga.
-- Aqui todas as perdedoras têm movimento 0, então a vencedora é sempre a
-- ficha original — as de 23 e 24/08 são as cópias.
--
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

DO $unir$
DECLARE
  pares CONSTANT UUID[][] := ARRAY[
    -- vencedora (ficha original)              |  perdedora (cópia, movimento 0)
    ['606e0642-8a76-4eb6-8637-19c9a7f13b88','1b16a1d9-6ed2-4d2a-b873-24886452277f'], -- amanda
    ['8d021a37-56cd-4827-bc9c-c11c05564d73','d817a363-fa3d-4893-9662-521d07fc3c88'], -- cassia goncalves
    ['70bc094a-582e-4cbe-b7c4-455eeadd55ae','52618ea6-bdad-4548-b409-6a57f7515ced'], -- cliente
    ['ebade409-d5d3-4f07-bfa3-bedb27dc5114','1222d2a1-b0b6-4736-8b9a-734d103501e2'], -- cliente 101010 (23/08)
    ['ebade409-d5d3-4f07-bfa3-bedb27dc5114','5205f014-3f52-4bd2-92e9-bb138388d5d1'], -- cliente 101010 (24/08)
    ['0675b11b-8c18-4c8c-a7ba-7909d780b21d','96198578-97ef-4eb8-a0f7-0fb31dde3830'], -- cliente 21982949060 (23/08)
    ['0675b11b-8c18-4c8c-a7ba-7909d780b21d','0b2b0f9f-9b00-4ecf-a162-b4c94c1f427a'], -- cliente 21982949060 (24/08)
    ['ae9c2e50-aa35-4277-aa26-7d3d9407cd5f','1a7cf203-7f7f-4319-87dd-c88733c47fa3'], -- daniel borracha **
    ['c659e805-bf72-4000-a0d3-8fc2c1d96038','2b8a8bd8-355e-4d4e-9600-36fbed2ef5c2'], -- igreja adventista bangu
    ['8bf5a783-b94c-4327-9be0-c1df545f8b25','ad947197-20e9-4db7-a451-2c0ca05ea833'], -- jaudo (23/08)
    ['8bf5a783-b94c-4327-9be0-c1df545f8b25','db33d728-9061-4d4a-b278-fead886d2393'], -- jaudo (24/08)
    ['01dca247-54b5-4c89-9c68-94654899b309','a1705c56-2da0-4b2d-b320-e5678f53967d'], -- josinaldo naldo eletricista **
    ['7f1544b1-918c-446e-9629-3068af818696','6f7cb749-2bee-4cee-8b4c-acb0d39f68f4'], -- luiz fernando
    ['c611d648-819f-43dc-b9ba-d8d1493b1582','689e4f51-53f2-4827-8517-3b30094f8408'], -- marcia tomaz
    ['2e9f7d1a-a57b-4cac-a8c2-aa02b3172d07','5f002a05-c5d6-4a07-8e1c-423b10160c0f'], -- mauricio tostes (camila)
    ['38dd7098-acbd-4478-84ad-6867a1fff13a','1e576f0a-5a3c-45c9-bac6-b7af1ba6979a'], -- michele cristina
    ['2de9d5cc-658b-4064-ad4a-e51886ffa867','f54a8d57-0935-4cba-a0d1-d45337f04953'], -- pedro
    ['a93285f7-d8bc-4b26-af14-dccafd68b268','f2d68928-9b8c-4a20-9622-5523a8bd7765'], -- rita / ziel
    ['c26e24c5-9ef1-45ae-b693-f3f679835e20','ab1d2c28-36f9-4278-adc4-c9a38489ac91'], -- rodolfo sanda
    ['872fb075-5922-4f4c-a71b-39a2173fa382','485b321e-e90f-45ac-9f3e-9c6369792718'], -- silva teste
    ['b54de73a-8a53-4e9a-854e-4aebedabfd64','179b5939-ebf0-46b2-8d74-1a5b79d8d628'], -- silvana (amiga da lili) **
    ['d3ea2f44-96a1-45f5-a88f-e81083b5735c','6f6e144f-8816-4028-b954-6a3b8cc86b39'], -- silvano
    ['892cbafb-4dc7-4a6e-98f9-15e2ed56db38','740b4b68-b6d7-441a-91be-badda88e29d8'], -- silvano vargas (23/08)
    ['892cbafb-4dc7-4a6e-98f9-15e2ed56db38','6967d64d-94ca-4027-944a-b2f6d3665490'], -- silvano vargas (24/08)
    ['625cc3ca-2140-4b6e-af2a-bc34f8b9d6c7','4642fb4e-3bd1-4c18-b739-c014cdb2573c'], -- tio henrique (tio rico)
    ['110679c2-9bdf-4320-912f-c70731f6913d','50d55ad6-dfa6-4ead-9110-b89da2b63192']  -- tio rico (tio do mauricio)
  ];
  i INT;
  venc UUID;
  perd UUID;
  n INT;
BEGIN
  FOR i IN 1 .. array_length(pares, 1) LOOP
    venc := pares[i][1];
    perd := pares[i][2];

    -- Mesma trava da primeira parte: mesma empresa, ids existentes, vencedora
    -- não mesclada. Um dígito trocado moveria cadastro entre clientes sem aviso.
    SELECT count(*) INTO n
      FROM clientes v JOIN clientes p ON p.empresa_id = v.empresa_id
     WHERE v.id = venc AND p.id = perd AND v.mesclado_em IS NULL;
    IF n <> 1 THEN
      RAISE EXCEPTION 'Par invalido: % -> %', perd, venc;
    END IF;

    -- A perdedora foi conferida com movimento 0, mas o reaponte fica assim
    -- mesmo: se algo tiver entrado nela entre a conferência e a execução,
    -- vai junto em vez de ficar órfão.
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
END
$unir$;

-- ── Conferência ─────────────────────────────────────────────
-- Esperado: 26 fichas a menos nas listas, e nenhum saldo alterado (todas as
-- perdedoras tinham movimento 0).
--
-- SELECT count(*) FILTER (WHERE mesclado_em IS NULL)  AS aparecem_nas_listas,
--        count(DISTINCT lower(trim(nome))) FILTER (WHERE mesclado_em IS NULL) AS nomes_distintos,
--        count(*) FILTER (WHERE mesclado_em IS NOT NULL) AS ocultos
--   FROM clientes
--  WHERE empresa_id = (SELECT id FROM empresas WHERE nome = 'Bazar Eficaz');
