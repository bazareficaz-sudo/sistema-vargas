-- Devolve ao balcão a baixa de estoque, parada desde 30/08/2026 08:32.
--
-- O QUE ACONTECEU
--
-- supabase-fechar-anon-onda2.sql (30/08, 08:32) fez, com razão:
--
--     REVOKE ALL ON marketplace_fila        FROM anon;
--     REVOKE ALL ON marketplace_fila_config FROM anon;
--
-- O raciocínio estava certo — "quem escreve na fila é o servidor do site,
-- nunca o navegador nem o terminal". O terminal de fato nunca escreve nessas
-- tabelas. Mas ele escreve nelas SEM SABER: `trg_fila_produto` é um gatilho
-- AFTER UPDATE em `produtos` e, como toda função plpgsql sem SECURITY
-- DEFINER, roda com o privilégio de QUEM disparou o UPDATE. A partir daquele
-- REVOKE, toda baixa de estoque do PDV passou a terminar assim:
--
--     ERROR 42501: permission denied for table marketplace_fila_config
--
-- E como é AFTER UPDATE, o erro aborta o UPDATE inteiro: o saldo não sai.
--
-- O estrago, medido no dia 02/09 comparando produtos.updated_at com o
-- horário da venda:
--
--     27/08   78 de  78 produtos vendidos tiveram o saldo baixado
--     28/08   96 de  96
--     30/08   31 de 134   ← o REVOKE foi às 08:32
--     31/08   17 de 146
--     01/09    4 de  80
--     02/09    5 de  96
--
-- As vendas continuaram gravando normalmente (a tabela `vendas` não tem
-- gatilho que toque na fila), e por isso o balcão não viu nada. Sumiram as
-- três escritas que andam juntas — produtos.estoque, produto_estoque e
-- estoque_movimentacoes — porque as três moram no mesmo trecho do terminal,
-- que ia embora na primeira falha.
--
-- Detalhe que atrasou o diagnóstico, e que vale registrar: o gatilho ignora
-- UPDATE que não muda estoque nem preço (IS NOT DISTINCT FROM). Então
-- qualquer teste que regravasse o MESMO valor — o teste seguro, o que a
-- gente faz primeiro para não sujar produção — passava com folga. Só um
-- UPDATE que muda o número de verdade reproduz a falha.
--
--
-- POR QUE ESTA CORREÇÃO, E NÃO UM GRANT DE VOLTA
--
-- Devolver `GRANT INSERT ON marketplace_fila TO anon` reabriria exatamente o
-- que a Onda 2 fechou de propósito, e ainda por um caminho que ninguém
-- lembraria de auditar depois. O certo é o contrário: a fila é maquinário
-- interno, então quem a alimenta deve rodar com o privilégio de DONO, não com
-- o de quem por acaso encostou na tabela `produtos`. É para isso que existe
-- SECURITY DEFINER.
--
-- Assim o anônimo continua sem poder ler, escrever ou apagar a fila — ele
-- apenas dispara, indiretamente, uma função que tem esse direito e faz uma
-- coisa só.
--
-- `search_path` fixo em cada função: sem isso, SECURITY DEFINER é um convite a
-- sequestro de resolução de nome por um schema plantado na frente.
--
--
-- ESCOPO
--
-- Só privilégio de execução. Nenhuma linha de dado é alterada aqui, e a
-- lógica das três funções é a mesma de supabase-marketplace-fila.sql — o
-- corpo está reproduzido igual, de propósito, para que a comparação seja
-- linha a linha.
--
-- O buraco já acumulado (as unidades que saíram da loja sem sair do sistema)
-- NÃO é corrigido por este arquivo. Ele é histórico e precisa ser
-- reconciliado à parte, a partir de venda_itens — ver o fim do arquivo.


-- ── 1. A função que enfileira ───────────────────────────────

CREATE OR REPLACE FUNCTION enfileirar_produto(
  p_empresa UUID, p_produto UUID, p_motivo TEXT, p_prioridade SMALLINT DEFAULT 0
) RETURNS void
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_empresa IS NULL OR p_produto IS NULL THEN RETURN; END IF;

  INSERT INTO marketplace_fila (empresa_id, produto_id, sujo_em, motivo, prioridade)
  VALUES (p_empresa, p_produto, now(), p_motivo, p_prioridade)
  ON CONFLICT (empresa_id, produto_id) DO UPDATE SET
    sujo_em = now(),
    motivo  = EXCLUDED.motivo,
    -- Prioridade só sobe: se o produto já estava marcado como urgente, uma
    -- movimentação comum depois não pode rebaixá-lo.
    prioridade = GREATEST(marketplace_fila.prioridade, EXCLUDED.prioridade);
END;
$$ LANGUAGE plpgsql;


-- ── 2. Gatilho de produtos ──────────────────────────────────
-- Lê marketplace_fila_config (era esta a leitura recusada, e é ela que
-- aparece na mensagem de erro) e chama enfileirar_produto.

CREATE OR REPLACE FUNCTION trg_fila_produto() RETURNS trigger
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_urgente INTEGER;
  v_prio SMALLINT := 0;
  v_motivo TEXT;
BEGIN
  IF NEW.estoque IS NOT DISTINCT FROM OLD.estoque
     AND NEW.preco_venda IS NOT DISTINCT FROM OLD.preco_venda THEN
    RETURN NEW;
  END IF;

  v_motivo := CASE
    WHEN NEW.estoque IS DISTINCT FROM OLD.estoque
     AND NEW.preco_venda IS DISTINCT FROM OLD.preco_venda THEN 'estoque e preço'
    WHEN NEW.estoque IS DISTINCT FROM OLD.estoque THEN 'estoque'
    ELSE 'preço'
  END;

  SELECT estoque_urgente INTO v_urgente
  FROM marketplace_fila_config WHERE empresa_id = NEW.empresa_id;

  IF NEW.estoque IS DISTINCT FROM OLD.estoque
     AND COALESCE(NEW.estoque, 0) <= COALESCE(v_urgente, 3) THEN
    v_prio := 1;
  END IF;

  PERFORM enfileirar_produto(NEW.empresa_id, NEW.id, v_motivo, v_prio);

  -- Kit muda quando o componente muda. O estoque do kit é derivado, então
  -- mexer no componente sem reenfileirar o kit deixaria o kit anunciado com
  -- um número que não é mais verdade.
  IF NEW.estoque IS DISTINCT FROM OLD.estoque THEN
    PERFORM enfileirar_produto(k.empresa_id, k.id, 'componente: ' || v_motivo, v_prio)
    FROM kit_itens ki
    JOIN produtos k ON k.id = ki.kit_id
    WHERE ki.produto_id = NEW.id
      AND COALESCE(ki.controla_estoque, true);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ── 3. Gatilho de produto_estoque ───────────────────────────
-- Mesmo problema, mesma origem: o terminal também escreve o saldo por
-- depósito, e este gatilho dispara em INSERT e em UPDATE.

CREATE OR REPLACE FUNCTION trg_fila_produto_estoque() RETURNS trigger
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_empresa UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.quantidade IS NOT DISTINCT FROM OLD.quantidade THEN
    RETURN NEW;
  END IF;

  SELECT empresa_id INTO v_empresa FROM produtos WHERE id = NEW.produto_id;
  PERFORM enfileirar_produto(v_empresa, NEW.produto_id, 'estoque do depósito', 0::SMALLINT);

  PERFORM enfileirar_produto(k.empresa_id, k.id, 'componente: estoque do depósito', 0::SMALLINT)
  FROM kit_itens ki
  JOIN produtos k ON k.id = ki.kit_id
  WHERE ki.produto_id = NEW.produto_id
    AND COALESCE(ki.controla_estoque, true);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- CONFERÊNCIA — rode logo depois, e antes de sair
--
-- 1. As três funções têm de aparecer como SECURITY DEFINER:
--
--   SELECT p.proname, p.prosecdef AS security_definer, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('enfileirar_produto','trg_fila_produto','trg_fila_produto_estoque');
--   -- esperado: security_definer = true nas três, proconfig com search_path
--
-- 2. O anônimo tem de continuar SEM acesso à fila (a Onda 2 segue valendo):
--
--   SELECT has_table_privilege('anon','marketplace_fila','INSERT') AS insere,
--          has_table_privilege('anon','marketplace_fila_config','SELECT') AS le;
--   -- esperado: false, false
--
-- 3. O teste que vale mais que todos, e o único que reproduz a falha —
--    um UPDATE que MUDA o número (regravar o mesmo valor não serve, o
--    gatilho ignora):
--
--   -- com a chave anônima, num produto qualquer:
--   --   UPDATE produtos SET estoque = estoque - 1 WHERE id = '<uuid>';
--   --   UPDATE produtos SET estoque = estoque + 1 WHERE id = '<uuid>';
--   -- esperado: as duas passam. Antes deste arquivo, a primeira devolvia
--   -- "42501 permission denied for table marketplace_fila_config".
--
-- 4. E, no balcão: FAZER UMA VENDA e conferir que o produto vendido
--    aparece em estoque_movimentacoes e que produtos.estoque desceu.
--
--
-- COMO DESFAZER
--
--   Reaplicar supabase-marketplace-fila.sql, que define as mesmas três
--   funções sem SECURITY DEFINER. Desfazer devolve a quebra: o balcão volta
--   a vender sem dar baixa.
--
--
-- O QUE ESTE ARQUIVO NÃO FAZ
--
--   Não repõe o estoque dos dias parados. De 30/08 a 02/09 as vendas
--   subiram sem baixa, e o saldo do sistema está alto em relação à
--   prateleira. A reposição tem de sair de venda_itens (a venda registrou
--   tudo direito), cruzando com estoque_movimentacoes para não descontar
--   duas vezes o que passou — as vendas de 30/08 anteriores às 08:32
--   baixaram normalmente. É trabalho de um script de reconciliação, com
--   conferência antes de gravar, não de uma migration.
-- ============================================================
