-- Fase 4C.1.1 — clientes.saldo_devedor passa a ser PROJEÇÃO de contas_receber.
--
-- O defeito: criar_conta_carteira inseria a conta — o que dispara o gatilho
-- que recalcula saldo_devedor a partir de SUM(valor_aberto) — e em seguida
-- somava a MESMA conta de novo. Medido em produção: 9 de 23 clientes com
-- conta divergentes, R$ 610,12 a mais, e nos 9 a diferença era exatamente o
-- valor_original da última conta de carteira criada.
--
-- É o caso produto_estoque × produtos.estoque outra vez: saldo em coluna
-- escrito por duas fontes. A correção elimina os escritores cegos e deixa
-- UMA regra.

-- 1. A REGRA, EM UM LUGAR SÓ
--
-- Semântica preservada exatamente como o gatilho já fazia: soma valor_aberto
-- e exclui apenas 'cancelado'. 'vencido' continua sendo dívida — são 11
-- contas da migração Base44 que nada mais escreve.
CREATE OR REPLACE FUNCTION public.saldo_devedor_autoritativo(p_cliente uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT coalesce(sum(cr.valor_aberto), 0)
    FROM contas_receber cr
   WHERE cr.cliente_id = p_cliente
     AND cr.status IS DISTINCT FROM 'cancelado';
$fn$;

-- 2. O GATILHO AUTORITATIVO PASSA A CHAMAR A REGRA
--
-- Mesmo comportamento de antes, sem a fórmula duplicada no corpo. Continua
-- recalculando os dois lados quando a conta troca de cliente, e continua
-- carimbando data_ultimo_pagamento só quando entrou dinheiro.
CREATE OR REPLACE FUNCTION public.sincronizar_saldo_devedor_cliente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_cliente_antigo uuid := null;
  v_cliente_novo   uuid := null;
  v_pagou          boolean := false;
  v_cliente        uuid;
BEGIN
  IF tg_op <> 'INSERT' THEN v_cliente_antigo := old.cliente_id; END IF;
  IF tg_op <> 'DELETE' THEN v_cliente_novo   := new.cliente_id; END IF;

  IF tg_op = 'UPDATE' THEN
    v_pagou := coalesce(new.valor_recebido, 0) > coalesce(old.valor_recebido, 0);
  END IF;

  FOR v_cliente IN
    SELECT DISTINCT id
      FROM unnest(array[v_cliente_antigo, v_cliente_novo]) AS t(id)
     WHERE id IS NOT NULL
  LOOP
    UPDATE clientes c
       SET saldo_devedor = saldo_devedor_autoritativo(v_cliente),
           data_ultimo_pagamento = CASE
             WHEN v_pagou AND v_cliente = v_cliente_novo THEN now()
             ELSE c.data_ultimo_pagamento
           END
     WHERE c.id = v_cliente;
  END LOOP;

  RETURN null;
END;
$fn$;

-- 3. FIM DO INCREMENTO CEGO NA CARTEIRA
--
-- Idêntica à versão anterior, menos o bloco
--   UPDATE clientes SET saldo_devedor = COALESCE(saldo_devedor,0) + v_valor
-- que somava pela segunda vez a conta recém-inserida.
--
-- O `updated_at = now()` que esse bloco fazia não se perde: o UPDATE do
-- gatilho autoritativo passa por trg_updated_at, que carimba sozinho — é o
-- que mantém o sync incremental de clientes do PDV enxergando a mudança.
CREATE OR REPLACE FUNCTION public.criar_conta_carteira()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_valor numeric;
BEGIN
  IF NEW.cliente_id IS NULL THEN RETURN NEW; END IF;

  SELECT sum((p->>'valor')::numeric) INTO v_valor
  FROM jsonb_array_elements(COALESCE(NEW.pagamentos::jsonb, '[]'::jsonb)) p
  WHERE p->>'forma' = 'carteira';

  IF v_valor IS NULL AND NEW.forma_pagamento = 'carteira' THEN
    v_valor := NEW.total;
  END IF;

  IF v_valor IS NULL OR v_valor <= 0 THEN RETURN NEW; END IF;

  IF EXISTS (SELECT 1 FROM contas_receber
             WHERE origem_id = NEW.id AND origem = 'carteira') THEN
    RETURN NEW;
  END IF;

  INSERT INTO contas_receber (
    empresa_id, cliente_id, cliente_nome, origem, origem_id, numero_doc,
    parcela_numero, total_parcelas, data_emissao, data_vencimento,
    valor_original, valor_recebido, status, operador_nome
  ) VALUES (
    NEW.empresa_id, NEW.cliente_id,
    COALESCE(NEW.cliente_nome, (SELECT nome FROM clientes WHERE id = NEW.cliente_id)),
    'carteira', NEW.id, 'CART-' || upper(right(NEW.id::text, 6)),
    1, 1, NEW.created_at::date, NEW.created_at::date,
    v_valor, 0, 'aberto', NEW.operador_nome
  );

  RETURN NEW;
END;
$fn$;

-- 4. UMA VENDA, UMA CONTA DE CARTEIRA — GARANTIA ESTRUTURAL
--
-- Hoje a unicidade é só o IF EXISTS acima: convenção de aplicação, o padrão
-- que este projeto recusa desde a Fase 1. Medido: 0 duplicatas, então a
-- trava nasce sem limpeza.
--
-- Parcial de propósito. Não pode ser UNIQUE(origem_id) genérico: o caminho
-- de FIADO cria N parcelas com o MESMO origem_id, e um índice sem o filtro
-- de origem quebraria o fiado parcelado. O IS NOT NULL preserva as 5 linhas
-- históricas da migração Base44/SYSEMP, que não têm origem_id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cr_carteira_uma_por_venda
  ON contas_receber (origem_id)
  WHERE origem = 'carteira' AND origem_id IS NOT NULL;

-- 5. CORREÇÃO DA PROJEÇÃO JÁ DIVERGENTE
--
-- Recalcula pela mesma regra, só onde há diferença. Nenhum valor fixo.
-- NÃO toca contas_receber, recebimentos, valor_original, valor_recebido nem
-- histórico: o que está errado é a projeção, não o documento financeiro.
UPDATE clientes c
   SET saldo_devedor = public.saldo_devedor_autoritativo(c.id)
 WHERE round(coalesce(c.saldo_devedor, 0), 2)
    <> round(public.saldo_devedor_autoritativo(c.id), 2);
