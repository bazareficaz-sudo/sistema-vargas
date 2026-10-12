-- FALTAS QUE SE RESOLVEM SOZINHAS + FIM DO PEDIDO DE COMPRA AUTOMÁTICO.
--
-- Até aqui a falta só saía da lista quando alguém clicava. O resultado,
-- medido em 11/10/2026: das 44 faltas abertas, 18 eram de produtos que já
-- tinham estoque — a mercadoria entrou e a falta ficou lá. E "Chegou" não
-- fechava nada: é o passo "avise o cliente", e falta sem cliente não tem a
-- quem avisar, então ficava em "Chegou" para sempre (caso da trena).
--
-- Três regras, todas no banco para valer em qualquer caminho (painel, PDV
-- web, PDV desktop, importação de XML):
--
--   1. ENTRADA DE MERCADORIA. Movimento de estoque de entrada de compra
--      (manual ou NF-e) de um produto com falta aberta anotada ANTES dela:
--        · sem cliente → 'atendido' (some da lista);
--        · com cliente → 'recebido' ("Chegou — avisar cliente").
--      A nota é o sinal de que chegou. Olhar só o estoque engana: há falta
--      anotada com estoque baixo mas positivo.
--
--   2. CLIENTE COMPROU. Item vendido a um cliente que tem falta/encomenda
--      aberta do mesmo produto (mesmo telefone ou mesmo nome) → 'atendido'.
--
--   3. "CHEGOU" SEM CLIENTE. Marcar 'recebido' numa falta sem cliente vira
--      'atendido' na hora: não há quem avisar.
--
-- Os triggers de entrada e venda NUNCA derrubam a operação que os disparou:
-- erro aqui vira aviso no log. Uma falta que não fechou se fecha à mão; uma
-- venda que não gravou é cliente indo embora.

CREATE OR REPLACE FUNCTION falta_tem_cliente(p_nome TEXT, p_telefone TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
  SELECT nullif(trim(coalesce(p_nome, '')), '') IS NOT NULL
      OR length(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g')) >= 8
$$;


-- ── 1. Entrada de mercadoria ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION faltas_baixa_por_entrada()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tipo NOT IN ('entrada_nfe', 'entrada_compra')
     OR coalesce(NEW.quantidade, 0) <= 0
     OR NEW.produto_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    UPDATE faltas f SET
      status = CASE WHEN falta_tem_cliente(f.cliente_nome, f.cliente_telefone) THEN 'recebido' ELSE 'atendido' END,
      resolvido_em = CASE WHEN falta_tem_cliente(f.cliente_nome, f.cliente_telefone) THEN f.resolvido_em ELSE now() END,
      resolvido_por = CASE WHEN falta_tem_cliente(f.cliente_nome, f.cliente_telefone) THEN f.resolvido_por
                           ELSE 'Automático — entrada de mercadoria' END
    WHERE f.empresa_id = NEW.empresa_id
      AND f.produto_id = NEW.produto_id
      AND f.status IN ('pendente', 'em_analise', 'em_compra', 'pedido', 'notificado', 'comprado')
      AND f.created_at < coalesce(NEW.created_at, now());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'faltas_baixa_por_entrada: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_faltas_baixa_por_entrada ON estoque_movimentacoes;
CREATE TRIGGER trg_faltas_baixa_por_entrada
  AFTER INSERT ON estoque_movimentacoes
  FOR EACH ROW EXECUTE FUNCTION faltas_baixa_por_entrada();


-- ── 2. Cliente comprou ──────────────────────────────────────────────────
-- venda_itens.venda_id e .produto_id são TEXT neste banco; o cast passa pela
-- checagem de formato para uma linha torta não virar erro.
CREATE OR REPLACE FUNCTION faltas_baixa_por_venda()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uuid CONSTANT TEXT := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_empresa UUID;
  v_cliente UUID;
  v_nome TEXT;
  v_tels TEXT[];
BEGIN
  IF coalesce(NEW.tipo, 'venda') <> 'venda'
     OR NEW.produto_id IS NULL OR NEW.produto_id !~* v_uuid
     OR NEW.venda_id IS NULL OR NEW.venda_id !~* v_uuid THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT v.empresa_id, v.cliente_id INTO v_empresa, v_cliente
    FROM vendas v WHERE v.id = NEW.venda_id::uuid;
    IF v_cliente IS NULL THEN RETURN NEW; END IF;

    SELECT lower(trim(coalesce(c.nome, ''))),
           array_remove(ARRAY[
             nullif(right(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), 8), ''),
             nullif(right(regexp_replace(coalesce(c.whatsapp, ''), '\D', '', 'g'), 8), ''),
             nullif(right(regexp_replace(coalesce(c.telefone_whatsapp, ''), '\D', '', 'g'), 8), '')
           ], NULL)
      INTO v_nome, v_tels
    FROM clientes c WHERE c.id = v_cliente;

    UPDATE faltas f SET
      status = 'atendido',
      resolvido_em = now(),
      resolvido_por = 'Automático — cliente comprou no PDV'
    WHERE f.empresa_id = v_empresa
      AND f.produto_id = NEW.produto_id::uuid
      AND f.status IN ('pendente', 'em_analise', 'em_compra', 'pedido', 'recebido', 'notificado', 'comprado')
      AND (
        (v_nome <> '' AND lower(trim(coalesce(f.cliente_nome, ''))) = v_nome)
        OR (length(regexp_replace(coalesce(f.cliente_telefone, ''), '\D', '', 'g')) >= 8
            AND right(regexp_replace(f.cliente_telefone, '\D', '', 'g'), 8) = ANY (v_tels))
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'faltas_baixa_por_venda: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_faltas_baixa_por_venda ON venda_itens;
CREATE TRIGGER trg_faltas_baixa_por_venda
  AFTER INSERT ON venda_itens
  FOR EACH ROW EXECUTE FUNCTION faltas_baixa_por_venda();


-- ── 3. "Chegou" sem cliente ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION faltas_chegou_sem_cliente()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'recebido'
     AND OLD.status IS DISTINCT FROM 'recebido'
     AND NOT falta_tem_cliente(NEW.cliente_nome, NEW.cliente_telefone) THEN
    NEW.status := 'atendido';
    NEW.resolvido_em := coalesce(NEW.resolvido_em, now());
    NEW.resolvido_por := coalesce(NEW.resolvido_por, 'Automático — chegou, sem cliente para avisar');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_faltas_chegou_sem_cliente ON faltas;
CREATE TRIGGER trg_faltas_chegou_sem_cliente
  BEFORE UPDATE OF status ON faltas
  FOR EACH ROW EXECUTE FUNCTION faltas_chegou_sem_cliente();

-- A lista de compra e os triggers procuram por produto entre as abertas.
CREATE INDEX IF NOT EXISTS idx_faltas_abertas_produto
  ON faltas (empresa_id, produto_id)
  WHERE status IN ('pendente', 'em_analise', 'em_compra', 'pedido', 'recebido', 'notificado', 'comprado');


-- ── Acerto do que já está no banco ──────────────────────────────────────
-- "Chegou" sem cliente que ficou parado: a regra 3, aplicada para trás.
-- (As pendentes com estoque NÃO fecham aqui: ficam para o comprador
-- conferir no filtro "Já tem estoque" da tela.)
UPDATE faltas SET
  status = 'atendido',
  resolvido_em = coalesce(resolvido_em, now()),
  resolvido_por = coalesce(resolvido_por, 'Automático — chegou, sem cliente para avisar')
WHERE status = 'recebido'
  AND NOT falta_tem_cliente(cliente_nome, cliente_telefone);


-- ── Fim do pedido de compra automático ──────────────────────────────────
-- A automação criava um rascunho sem fornecedor por dia em que algum
-- produto caía abaixo do mínimo. O "abaixo do mínimo" agora aparece na
-- lista de faltas (calculado na hora, com o fornecedor), e o comprador
-- monta o pedido a partir dela.
UPDATE pedidos_compra SET
  status = 'cancelado',
  cancelado_em = now(),
  cancelado_motivo = 'Rascunho automático substituído pela lista de faltas (itens abaixo do mínimo aparecem lá).',
  updated_at = now()
WHERE origem = 'automacao' AND status = 'rascunho';

UPDATE automacoes SET ativa = false, updated_at = now()
WHERE tipo = 'reposicao_pedido_automatico' AND ativa;
