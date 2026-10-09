-- Fase 4C.2 — Checkpoint 3, parte B: a carteira passa pelo pagamento.
--
-- Em v1 a conta a receber nasce de `criar_conta_carteira`, AFTER INSERT em
-- `vendas`, lendo `NEW.pagamentos`. Em v2 os pagamentos chegam DEPOIS da
-- venda, então aquele gatilho não vê nada e a conta não nasceria. A parte A
-- recusou carteira em v2 por isso. Agora ela passa a ter caminho próprio.
--
-- Este gatilho fica INERTE enquanto a RPC recusar carteira em v2:
-- `venda_pagamento` só é escrita por ela.

-- REGRAS QUE ELE IMPLEMENTA, todas decididas antes:
--
-- a) uma venda gera UMA conta. R$ 50 + R$ 30 de carteira na mesma venda são
--    uma obrigação de R$ 80, não duas de 50 e 30.
-- b) o valor é RECALCULADO da soma autoritativa em `venda_pagamento`, nunca
--    `valor_existente + novo_pagamento`. Incremento cego foi o defeito que
--    a 4C.1.1 extirpou; não volta por aqui.
-- c) conta já TOCADA — com qualquer recebimento, quitada ou cancelada — não
--    é reescrita. Nem vira parcela 2. Falha alto e exige fluxo próprio.
-- d) `clientes.saldo_devedor` NÃO é escrito aqui. Ele é projeção, e quem o
--    mantém é `z_trg_sincronizar_saldo_devedor`, que dispara sozinho na
--    escrita de `contas_receber`.
CREATE OR REPLACE FUNCTION public.venda_pagamento_carteira()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_total   numeric;
  v_venda   vendas%ROWTYPE;
  v_conta   contas_receber%ROWTYPE;
BEGIN
  IF NEW.forma <> 'carteira' THEN RETURN NULL; END IF;

  -- A soma autoritativa: tudo que é carteira nesta venda, estornos
  -- descontados. Não depende da ordem em que os pagamentos chegaram.
  SELECT coalesce(sum(CASE WHEN p.estorno_de_id IS NULL THEN p.valor ELSE -p.valor END), 0)
    INTO v_total
    FROM venda_pagamento p
   WHERE p.venda_id = NEW.venda_id AND p.forma = 'carteira';

  IF v_total <= 0 THEN RETURN NULL; END IF;

  SELECT * INTO v_venda FROM vendas WHERE id = NEW.venda_id;
  IF NOT FOUND OR v_venda.cliente_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_conta
    FROM contas_receber
   WHERE origem = 'carteira' AND origem_id = NEW.venda_id
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO contas_receber (
      empresa_id, cliente_id, cliente_nome, origem, origem_id, numero_doc,
      parcela_numero, total_parcelas, data_emissao, data_vencimento,
      valor_original, valor_recebido, status, operador_nome
    ) VALUES (
      v_venda.empresa_id, v_venda.cliente_id,
      coalesce(v_venda.cliente_nome, (SELECT nome FROM clientes WHERE id = v_venda.cliente_id)),
      'carteira', NEW.venda_id, 'CART-' || upper(right(NEW.venda_id::text, 6)),
      1, 1, v_venda.created_at::date, v_venda.created_at::date,
      v_total, 0, 'aberto', v_venda.operador_nome
    );
    RETURN NULL;
  END IF;

  -- Conta já existe. Só pode ser reavaliada se continuar INTOCADA.
  IF v_conta.valor_recebido <> 0 OR v_conta.status IN ('cancelado', 'recebido') THEN
    RAISE EXCEPTION
      'conta de carteira da venda % ja foi movimentada (status=%, recebido=%); a composicao nao pode ser reescrita',
      NEW.venda_id, v_conta.status, v_conta.valor_recebido
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Intocada: alinha ao valor autoritativo. O gatilho de saldo dispara
  -- sozinho neste UPDATE e recalcula o cadastro do cliente.
  IF round(v_conta.valor_original, 2) <> round(v_total, 2) THEN
    UPDATE contas_receber
       SET valor_original = v_total, updated_at = now()
     WHERE id = v_conta.id;
  END IF;

  RETURN NULL;
END;
$fn$;

-- Nome com `z_` para correr DEPOIS da projeção de `vendas.pagamentos`:
-- assim, se este gatilho abortar, nada ficou meio feito.
DROP TRIGGER IF EXISTS z_trg_venda_pagamento_carteira ON venda_pagamento;
CREATE TRIGGER z_trg_venda_pagamento_carteira
  AFTER INSERT ON venda_pagamento
  FOR EACH ROW EXECUTE FUNCTION venda_pagamento_carteira();
