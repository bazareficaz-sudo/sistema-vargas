-- ============================================================
-- CLIENTES DUPLICADOS: FECHAR A PORTA, NÃO SÓ VARRER O CHÃO
--
-- Terceira vez que a mesma coisa acontece. 07/08 foram 8 cópias no mesmo
-- minuto, 24/08 foram 33 no mesmo minuto (13:16), 23/08 mais 6. NELSON
-- ROQUE ficou com 3 cadastros vivos, ESCRITORIO CONTABILIDADE ROCHA
-- RANGEL com 2 — e outros 31 nomes na mesma situação.
--
-- ── De onde vinham ───────────────────────────────────────────
--
-- Não é o operador cadastrando duas vezes: 33 cadastros num minuto é
-- máquina. É o PDV externo.
--
-- O PDV guarda uma cópia local de cada cliente com o `remote_id` do
-- Supabase. Quando esse remote_id é apagado — e a rotina que conserta ids
-- herdados do Base44 apaga de propósito, na atualização de versão — o PDV
-- reenvia o cliente. O envio era um INSERT cego: nunca perguntava se
-- aquele cliente já estava aqui. Quatro caminhos diferentes no PDV
-- chamavam esse INSERT, e nenhum checava.
--
-- Por isso a limpeza de 07/08 não resolveu: ela varreu as cópias, mas a
-- porta continuou aberta e a próxima atualização de versão do PDV
-- despejou tudo de novo.
--
-- ── O que muda aqui ──────────────────────────────────────────
--
-- No PDV (repositório vargasnexus-pdv) o envio passou a resolver o
-- cadastro antes de criar. Mas o PDV é UMA das portas — tem o sistema
-- web, tem importação, tem API. Então a regra desce pro banco, igual foi
-- feito com a conta de carteira (supabase-corrigir-carteira-e-clientes-
-- duplicados.sql, ETAPA 4) e com o redirecionamento de cliente mesclado
-- (supabase-cliente-mesclado-redirecionar.sql).
--
-- O gatilho da ETAPA 3 não BLOQUEIA o cadastro repetido — ele deixa a
-- linha nascer já marcada como cópia (`mesclado_em` apontando pro
-- original, `ativo = false`). Isso importa: quem inseriu recebe um id
-- válido de volta e não quebra, a tela de Clientes não mostra a cópia, e
-- os gatilhos de redirecionamento que já existem mandam toda venda,
-- conta e orçamento pro cadastro de verdade. Bloquear com erro faria o
-- PDV externo entender "falhou, tenta de novo" e a venda ficaria presa
-- na fila para sempre.
--
-- RODE EM ETAPAS. A ETAPA 0 é só leitura.
-- ============================================================


-- ============================================================
-- ETAPA 0 — CONFERÊNCIA (só leitura, não muda nada)
-- ============================================================

-- 0a. Nomes com mais de um cadastro vivo hoje
SELECT upper(trim(nome)) AS nome,
       count(*) AS cadastros_vivos,
       min(created_at)::date AS primeiro,
       max(created_at)::date AS ultimo,
       string_agg(DISTINCT coalesce(telefone, '(sem telefone)'), ' | ') AS telefones
FROM clientes
WHERE ativo AND mesclado_em IS NULL
GROUP BY 1 HAVING count(*) > 1
ORDER BY 2 DESC, 1;

-- 0b. As rajadas: cadastro em massa é assinatura de sincronização, não de gente
SELECT date_trunc('minute', created_at) AS minuto, count(*) AS cadastros
FROM clientes GROUP BY 1 HAVING count(*) > 3 ORDER BY 1 DESC;


-- ============================================================
-- ETAPA 1 — A CHAVE DE COMPARAÇÃO E A FUNÇÃO DE MESCLAGEM
--
-- `cliente_chave_dedup` precisa dar exatamente o mesmo resultado que
-- `_chaveNome()` do PDV (vargasnexus-pdv, src/main/api.js). Se os dois
-- discordarem sobre o que é o mesmo nome, a duplicata volta pela porta
-- que o outro lado não vigia.
--
-- `translate` em vez de `unaccent`: dá o mesmo resultado para o alfabeto
-- que a loja usa, é IMMUTABLE de verdade (dá pra indexar) e não depende
-- de dicionário instalado no servidor.
-- ============================================================

CREATE OR REPLACE FUNCTION cliente_chave_dedup(nome TEXT) RETURNS TEXT AS $$
  SELECT upper(trim(regexp_replace(
    translate(coalesce(nome, ''),
              'áàãâäéèêëíìîïóòõôöúùûüçñÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑ',
              'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'),
    '\s+', ' ', 'g')));
$$ LANGUAGE sql IMMUTABLE;

CREATE INDEX IF NOT EXISTS idx_clientes_chave_dedup
  ON clientes (empresa_id, cliente_chave_dedup(nome))
  WHERE ativo AND mesclado_em IS NULL;

-- Só dígitos, para comparar telefone e CPF sem sofrer com máscara: a base
-- tem "21 99817-0077" e "21998170077" convivendo como se fossem números
-- diferentes.
CREATE OR REPLACE FUNCTION so_digitos(v TEXT) RETURNS TEXT AS $$
  SELECT regexp_replace(coalesce(v, ''), '\D', '', 'g');
$$ LANGUAGE sql IMMUTABLE;

-- Mesmo cliente = nome igual E nada que desminta. Telefone e documento
-- ou batem, ou um dos lados está vazio.
--
-- Telefone diferente sozinho NÃO separa? Separa sim — mas telefone VAZIO
-- de um lado não pode inventar cadastro novo, e era exatamente aí que
-- estava o vazamento: o NELSON que voltou tinha telefone nulo, o que já
-- existia tinha 21988126772, e o PDV concluiu "gente diferente".
--
-- O contrário também vale, e é o motivo de exigir nome igual: SILVANO,
-- SILVANO VARGAS e CLIENTE 21982949060 dividem o número 21982949060 e
-- são cadastros distintos de propósito. Telefone igual com nome
-- diferente nunca é motivo para fundir.
CREATE OR REPLACE FUNCTION clientes_equivalentes(
  nome_a TEXT, tel_a TEXT, doc_a TEXT,
  nome_b TEXT, tel_b TEXT, doc_b TEXT
) RETURNS BOOLEAN AS $$
  SELECT cliente_chave_dedup(nome_a) = cliente_chave_dedup(nome_b)
     AND cliente_chave_dedup(nome_a) <> ''
     AND (so_digitos(tel_a) = '' OR so_digitos(tel_b) = '' OR so_digitos(tel_a) = so_digitos(tel_b))
     AND (so_digitos(doc_a) = '' OR so_digitos(doc_b) = '' OR so_digitos(doc_a) = so_digitos(doc_b));
$$ LANGUAGE sql IMMUTABLE;


-- Mesclar de verdade: repontar TUDO que aponta pro perdedor.
--
-- A limpeza de 07/08 repontou três tabelas (vendas, contas_receber,
-- orcamentos). São quatorze. Crédito de cliente, entrega, renegociação e
-- histórico de cobrança ficaram pendurados nos cadastros que morreram
-- naquele dia — dinheiro e entrega presos num cliente inativo.
CREATE OR REPLACE FUNCTION mesclar_cliente(perdedor UUID, vencedor UUID)
RETURNS VOID AS $$
BEGIN
  IF perdedor = vencedor OR perdedor IS NULL OR vencedor IS NULL THEN RETURN; END IF;

  UPDATE vendas            SET cliente_id = vencedor WHERE cliente_id = perdedor;
  UPDATE contas_receber    SET cliente_id = vencedor WHERE cliente_id = perdedor;
  UPDATE orcamentos        SET cliente_id = vencedor WHERE cliente_id = perdedor;
  UPDATE recebimentos      SET cliente_id = vencedor WHERE cliente_id = perdedor;
  UPDATE creditos_cliente  SET cliente_id = vencedor WHERE cliente_id = perdedor;
  UPDATE cobranca_historico SET cliente_id = vencedor WHERE cliente_id = perdedor;
  UPDATE renegociacoes     SET cliente_id = vencedor WHERE cliente_id = perdedor;
  UPDATE entregas          SET cliente_id = vencedor WHERE cliente_id = perdedor;
  UPDATE automacoes        SET cliente_id = vencedor WHERE cliente_id = perdedor;
  UPDATE loja_carrinhos    SET cliente_id = vencedor WHERE cliente_id = perdedor;
  UPDATE cliente_contatos  SET cliente_id = vencedor WHERE cliente_id = perdedor;

  -- Endereço de entrega tem índice único de "um padrão por cliente": o
  -- endereço da cópia chega como não-padrão para não colidir com o do
  -- vencedor. O endereço não se perde, só deixa de ser o preferido.
  UPDATE cliente_enderecos_entrega SET padrao = false WHERE cliente_id = perdedor;
  UPDATE cliente_enderecos_entrega SET cliente_id = vencedor WHERE cliente_id = perdedor;

  -- Acesso à loja online é único por (loja, usuário): se o vencedor já
  -- tem acesso, o da cópia é dispensável; senão, migra.
  DELETE FROM loja_clientes_acesso a
   WHERE a.cliente_id = perdedor
     AND EXISTS (SELECT 1 FROM loja_clientes_acesso b
                  WHERE b.cliente_id = vencedor AND b.loja_id = a.loja_id AND b.user_id = a.user_id);
  UPDATE loja_clientes_acesso SET cliente_id = vencedor WHERE cliente_id = perdedor;

  -- O vencedor herda o que só a cópia tinha preenchido. Sem isso a
  -- unificação PERDE dado: o telefone que só existia na cópia sumiria, e
  -- na próxima vez os dois voltariam a parecer gente diferente.
  UPDATE clientes v SET
    telefone   = coalesce(v.telefone,   p.telefone),
    whatsapp   = coalesce(v.whatsapp,   p.whatsapp),
    cpf_cnpj   = coalesce(v.cpf_cnpj,   p.cpf_cnpj),
    email      = coalesce(v.email,      p.email),
    cep        = coalesce(v.cep,        p.cep),
    logradouro = coalesce(v.logradouro, p.logradouro),
    numero     = coalesce(v.numero,     p.numero),
    complemento= coalesce(v.complemento,p.complemento),
    bairro     = coalesce(v.bairro,     p.bairro),
    cidade     = coalesce(v.cidade,     p.cidade),
    estado     = coalesce(v.estado,     p.estado),
    limite_credito = greatest(coalesce(v.limite_credito, 0), coalesce(p.limite_credito, 0)),
    updated_at = now()
  FROM clientes p
  WHERE v.id = vencedor AND p.id = perdedor;

  -- A cópia não é apagada: vira apelido do original. Histórico
  -- preservado, e os gatilhos redirecionar_cliente_mesclado mandam
  -- lançamento novo que ainda chegue com o id velho pro lugar certo.
  UPDATE clientes SET
    ativo = false, mesclado_em = vencedor, mesclado_em_data = now(),
    saldo_devedor = 0, updated_at = now()
  WHERE id = perdedor;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- ETAPA 2 — UNIFICAR O QUE JÁ ESTÁ DUPLICADO
--
-- Sobrevive o MAIS ANTIGO de cada grupo: é o que tem o histórico mais
-- longo e o id que os terminais antigos já conhecem.
--
-- Ao contrário da limpeza de 07/08, aqui não há corte por data. Aquele
-- corte ("só o que nasceu depois de 07/08") foi o que deixou passar a
-- rodada de 24/08 sem ninguém perceber que era o mesmo problema. O que
-- protege contra fundir gente diferente é o critério de equivalência
-- (nome igual, telefone e documento não conflitantes), não a data.
-- ============================================================

DO $$
DECLARE
  candidato RECORD;
  vencedor  UUID;
  total     INT := 0;
BEGIN
  LOOP
    -- Um par por vez, sempre o mais antigo como vencedor. O laço repete
    -- até não achar mais par, o que resolve grupos de 3+ em cadeia.
    SELECT a.id AS vencedor_id, b.id AS perdedor_id INTO candidato
    FROM clientes a
    JOIN clientes b
      ON b.empresa_id = a.empresa_id
     AND b.id <> a.id
     AND (a.created_at, a.id) < (b.created_at, b.id)
     AND clientes_equivalentes(a.nome, a.telefone, a.cpf_cnpj,
                               b.nome, b.telefone, b.cpf_cnpj)
    WHERE a.ativo AND a.mesclado_em IS NULL
      AND b.ativo AND b.mesclado_em IS NULL
    ORDER BY a.created_at, a.id, b.created_at, b.id
    LIMIT 1;

    EXIT WHEN NOT FOUND;

    PERFORM mesclar_cliente(candidato.perdedor_id, candidato.vencedor_id);
    total := total + 1;
    EXIT WHEN total > 5000;  -- trava de segurança, nunca deve ser atingida
  END LOOP;

  RAISE NOTICE 'Cadastros unificados: %', total;
END $$;


-- ============================================================
-- ETAPA 3 — IMPEDIR QUE ACONTEÇA DE NOVO, POR QUALQUER PORTA
--
-- BEFORE INSERT: se já existe cadastro equivalente, a linha nova nasce
-- como apelido dele em vez de virar concorrente.
--
-- Deixa nascer em vez de recusar de propósito. O PDV externo faz
-- `.insert(...).select().single()` — recusar devolveria erro, ele
-- entenderia "não consegui gravar" e a venda ficaria eternamente na fila
-- de pendências. Nascendo como apelido, ele recebe um id válido, grava a
-- venda, e o gatilho a_trg_redirecionar_cliente (já instalado em vendas,
-- contas_receber, orcamentos e recebimentos) coloca a venda no cadastro
-- certo antes de gravar.
-- ============================================================

CREATE OR REPLACE FUNCTION impedir_cliente_duplicado() RETURNS trigger AS $$
DECLARE
  original UUID;
BEGIN
  -- Só olha cadastro que está nascendo vivo e solto. Importação que já
  -- chega marcada como cópia passa direto.
  IF NEW.mesclado_em IS NOT NULL OR NEW.ativo IS DISTINCT FROM true THEN RETURN NEW; END IF;
  IF cliente_chave_dedup(NEW.nome) = '' THEN RETURN NEW; END IF;

  SELECT c.id INTO original
  FROM clientes c
  WHERE c.empresa_id IS NOT DISTINCT FROM NEW.empresa_id
    AND c.id <> NEW.id
    AND c.ativo AND c.mesclado_em IS NULL
    AND clientes_equivalentes(c.nome, c.telefone, c.cpf_cnpj,
                              NEW.nome, NEW.telefone, NEW.cpf_cnpj)
  ORDER BY c.created_at, c.id
  LIMIT 1;

  IF original IS NULL THEN RETURN NEW; END IF;

  NEW.ativo            := false;
  NEW.mesclado_em      := original;
  NEW.mesclado_em_data := now();
  NEW.saldo_devedor    := 0;

  RAISE NOTICE 'Cadastro repetido de "%" redirecionado para %', NEW.nome, original;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_impedir_cliente_duplicado ON clientes;
CREATE TRIGGER trg_impedir_cliente_duplicado
  BEFORE INSERT ON clientes
  FOR EACH ROW EXECUTE FUNCTION impedir_cliente_duplicado();


-- Completar telefone/CPF de um cadastro pode transformá-lo em duplicata
-- de outro que já existia. Não é hipótese: é o caminho normal do PDV
-- ("achei o cliente sem telefone, gravei o telefone"). O UPDATE não é
-- barrado — só marcado, para aparecer no relatório da ETAPA 5 e ser
-- unificado com um comando, em vez de virar mais uma cópia silenciosa.
CREATE OR REPLACE FUNCTION avisar_cliente_virou_duplicado() RETURNS trigger AS $$
DECLARE
  original UUID;
BEGIN
  IF NEW.mesclado_em IS NOT NULL OR NOT NEW.ativo THEN RETURN NEW; END IF;
  IF NEW.nome IS NOT DISTINCT FROM OLD.nome
     AND NEW.telefone IS NOT DISTINCT FROM OLD.telefone
     AND NEW.cpf_cnpj IS NOT DISTINCT FROM OLD.cpf_cnpj THEN RETURN NEW; END IF;

  SELECT c.id INTO original
  FROM clientes c
  WHERE c.empresa_id IS NOT DISTINCT FROM NEW.empresa_id
    AND c.id <> NEW.id AND c.ativo AND c.mesclado_em IS NULL
    AND clientes_equivalentes(c.nome, c.telefone, c.cpf_cnpj,
                              NEW.nome, NEW.telefone, NEW.cpf_cnpj)
  ORDER BY c.created_at, c.id LIMIT 1;

  IF original IS NOT NULL THEN
    RAISE NOTICE 'Cliente % agora é equivalente a % — unificar com: SELECT mesclar_cliente(%, %);',
      NEW.id, original, quote_literal(NEW.id), quote_literal(original);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_avisar_cliente_duplicado ON clientes;
CREATE TRIGGER trg_avisar_cliente_duplicado
  BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION avisar_cliente_virou_duplicado();


-- ============================================================
-- ETAPA 4 — RECALCULAR SALDO DEVEDOR
--
-- Da fonte (contas em aberto), não somando o cache — mesmo raciocínio da
-- ETAPA 3 do conserto de 07/08. Depois de unificar, a dívida que estava
-- espalhada entre cópias precisa aparecer inteira num cliente só.
-- ============================================================

UPDATE clientes c SET
  saldo_devedor = CASE WHEN c.mesclado_em IS NOT NULL THEN 0 ELSE COALESCE((
    SELECT sum(cr.valor_original - COALESCE(cr.valor_recebido, 0))
    FROM contas_receber cr
    WHERE cr.cliente_id = c.id AND cr.status IN ('aberto', 'vencido')
  ), 0) END,
  updated_at = now();


-- ============================================================
-- ETAPA 5 — O QUE SOBROU PARA DECIDIR À MÃO
--
-- Mesmo nome, telefones DIFERENTES nos dois lados. O banco não funde
-- isso sozinho de propósito — pode ser pai e filho, pode ser o mesmo
-- cliente com um número de recado. Fundir por engano é pior que a cópia.
--
-- Caso conhecido: ESCRITORIO CONTABILIDADE ROCHA RANGEL tem 21964286357
-- (o verdadeiro) e 2199999999 (visivelmente digitado para preencher). Esse
-- par já foi conferido à mão em 31/08 (ver
-- supabase-unificar-clientes-duplicados-20260831.sql, que revisou os casos
-- em que a dívida estava partida entre duas fichas) — a cópia de 24/08 é
-- do mesmo cliente. Rode:
--
--   SELECT mesclar_cliente('91ab138e-c639-4d71-b9f2-e14b081459e1',
--                          'a188415c-5cd1-4c1a-9514-3045e1e8f8d0');
--
-- Para os demais, depois de conferir:
--     SELECT mesclar_cliente('<id-da-copia>', '<id-do-original>');
-- ============================================================

SELECT a.id AS manter_id, a.nome, a.telefone AS tel_manter, a.created_at::date AS desde,
       b.id AS copia_id, b.telefone AS tel_copia, b.created_at::date AS copia_desde,
       (SELECT count(*) FROM vendas WHERE cliente_id = b.id) AS vendas_na_copia,
       format('SELECT mesclar_cliente(%L, %L);', b.id, a.id) AS comando_para_unificar
FROM clientes a
JOIN clientes b
  ON b.empresa_id = a.empresa_id
 AND (a.created_at, a.id) < (b.created_at, b.id)
 AND cliente_chave_dedup(a.nome) = cliente_chave_dedup(b.nome)
WHERE a.ativo AND a.mesclado_em IS NULL
  AND b.ativo AND b.mesclado_em IS NULL
ORDER BY a.nome;


-- ============================================================
-- ETAPA 6 — CONFERÊNCIA FINAL
-- ============================================================

-- Deve voltar vazio: nenhum nome com dois cadastros vivos e telefone
-- compatível (o que sobrar aqui é ambiguidade real, listada na ETAPA 5).
SELECT upper(trim(nome)) AS nome, count(*) AS cadastros_vivos
FROM clientes WHERE ativo AND mesclado_em IS NULL
GROUP BY 1 HAVING count(*) > 1 ORDER BY 2 DESC;

-- Deve voltar 0: nada pendurado em cadastro que virou cópia.
SELECT
  (SELECT count(*) FROM contas_receber cr JOIN clientes c ON c.id = cr.cliente_id WHERE c.mesclado_em IS NOT NULL) AS contas_orfas,
  (SELECT count(*) FROM vendas v        JOIN clientes c ON c.id = v.cliente_id  WHERE c.mesclado_em IS NOT NULL) AS vendas_orfas,
  (SELECT count(*) FROM creditos_cliente k JOIN clientes c ON c.id = k.cliente_id WHERE c.mesclado_em IS NOT NULL) AS creditos_orfaos,
  (SELECT count(*) FROM entregas e      JOIN clientes c ON c.id = e.cliente_id  WHERE c.mesclado_em IS NOT NULL) AS entregas_orfas;

-- Teste do gatilho (não deixa lixo: desfaz no fim).
DO $$
DECLARE alvo RECORD; novo UUID; virou UUID;
BEGIN
  SELECT id, empresa_id, nome, telefone INTO alvo
  FROM clientes WHERE ativo AND mesclado_em IS NULL ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE NOTICE 'Sem clientes para testar'; RETURN; END IF;

  INSERT INTO clientes (empresa_id, nome, telefone, ativo)
  VALUES (alvo.empresa_id, alvo.nome, NULL, true) RETURNING id INTO novo;

  SELECT mesclado_em INTO virou FROM clientes WHERE id = novo;
  IF virou = alvo.id THEN
    RAISE NOTICE 'OK: cadastro repetido de "%" nasceu apontando para o original', alvo.nome;
  ELSE
    RAISE WARNING 'FALHOU: a cópia nasceu solta (mesclado_em = %)', virou;
  END IF;

  DELETE FROM clientes WHERE id = novo;
END $$;
