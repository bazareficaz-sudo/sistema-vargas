-- ============================================================
-- REPARO: vendas de CARTEIRA que não foram para a conta do cliente
--         + clientes duplicados pela sincronização do PDV externo
--
-- RODE EM ETAPAS. A ETAPA 0 é só leitura — confira os números antes de
-- executar o resto. Isto mexe em dinheiro a receber.
--
-- ── O que foi medido na base (07/08/2026) ────────────────────
--
--   125 vendas com forma de pagamento CARTEIRA
--    38 têm conta a receber
--    87 NÃO têm            → R$ 4.498,15 que ninguém foi cobrado
--
--   236 cadastros de clientes, dos quais 231 são duplicatas.
--   Quase todas criadas em 07/08 — o dia em que a fila do PDV externo
--   descarregou. "LUIZ FERNANDO" tem 9 cópias, "BALCAO" 9, "AMANDA" 9.
--
-- ── Por que aconteceu ────────────────────────────────────────
--
-- 1. DUPLICAÇÃO: bug da sincronização do PDV externo (já corrigido lá).
--    O estrago ficou aqui.
--
-- 2. CONTA NÃO CRIADA: a regra "carteira vira conta a receber" existia em
--    UM lugar só — o código de tela do PDV web. O PDV externo grava a venda
--    direto no banco e nunca passa por esse código, então a conta nunca era
--    criada. Não é um caso perdido no meio do caminho: é um caminho que
--    nunca teve a regra.
--
--    É o mesmo padrão do estoque que discutimos: regra que mora na tela não
--    alcança quem entra por outra porta. Por isso a ETAPA 4 move a regra
--    para um gatilho no banco, que alcança todos os caminhos.
--
-- A ordem importa: deduplicar ANTES de criar as contas, senão a dívida
-- nasce espalhada entre cópias do mesmo cliente.
-- ============================================================


-- ============================================================
-- ETAPA 0 — CONFERÊNCIA (só leitura, não muda nada)
-- ============================================================

-- 0a. Quantas vendas de carteira estão sem conta, e quanto somam
SELECT count(*) AS vendas_sem_conta,
       round(sum(v.total)::numeric, 2) AS valor_nao_cobrado
FROM vendas v
WHERE (v.forma_pagamento = 'carteira'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v.pagamentos::jsonb, '[]'::jsonb)) p
                  WHERE p->>'forma' = 'carteira'))
  AND NOT EXISTS (SELECT 1 FROM contas_receber c
                  WHERE c.origem_id = v.id AND c.origem = 'carteira');

-- 0b. Clientes que seriam unificados (mantém o mais antigo de cada nome)
SELECT upper(trim(nome)) AS nome, count(*) AS cadastros,
       min(created_at)::date AS mais_antigo
FROM clientes
GROUP BY 1 HAVING count(*) > 1
ORDER BY 2 DESC, 1;


-- ============================================================
-- ETAPA 1 — UNIFICAR OS CLIENTES DUPLICADOS
--
-- Regra deliberadamente estreita: só unifica cadastros criados a partir de
-- 07/08/2026, que é quando o bug de sincronização rodou. Dois clientes de
-- verdade com o mesmo nome, cadastrados em épocas diferentes, NÃO são
-- tocados — o que evita fundir pessoas distintas por coincidência de nome.
--
-- Sobrevive o mais antigo de cada nome. As cópias não são apagadas: ficam
-- inativas, para o histórico não sumir e para dar como desfazer.
-- ============================================================

CREATE TEMP TABLE _merge_clientes AS
WITH ranked AS (
  SELECT id, empresa_id, upper(trim(nome)) AS chave, created_at,
         first_value(id) OVER (PARTITION BY empresa_id, upper(trim(nome))
                               ORDER BY created_at, id) AS vencedor_id
  FROM clientes
  WHERE trim(COALESCE(nome, '')) <> ''
)
SELECT id AS perdedor_id, vencedor_id
FROM ranked
WHERE id <> vencedor_id
  AND created_at >= '2026-08-07';

-- Repontar tudo que aponta para cliente. Só existem estas três tabelas —
-- conferido consultando cada candidata na base.
UPDATE vendas v SET cliente_id = m.vencedor_id
FROM _merge_clientes m WHERE v.cliente_id = m.perdedor_id;

UPDATE contas_receber c SET cliente_id = m.vencedor_id
FROM _merge_clientes m WHERE c.cliente_id = m.perdedor_id;

UPDATE orcamentos o SET cliente_id = m.vencedor_id
FROM _merge_clientes m WHERE o.cliente_id = m.perdedor_id;

-- Desativa as cópias em vez de apagar (mesma cautela do resto do sistema).
UPDATE clientes SET ativo = false, updated_at = now()
WHERE id IN (SELECT perdedor_id FROM _merge_clientes);

SELECT count(*) AS clientes_unificados FROM _merge_clientes;


-- ============================================================
-- ETAPA 2 — CRIAR AS CONTAS A RECEBER QUE FALTAM
--
-- Mesmo formato que o PDV web já usava: origem 'carteira', origem_id = id da
-- venda, uma parcela, vencimento na data da venda.
--
-- O valor é a parcela paga em carteira — não o total da venda. Venda metade
-- dinheiro, metade carteira cobra só a metade.
--
-- Venda sem cliente_id fica de fora: são 3 casos, e cobrar de "ninguém" não
-- é conserto. Ficam listadas na ETAPA 5 para tratamento manual.
-- ============================================================

INSERT INTO contas_receber (
  empresa_id, cliente_id, cliente_nome, origem, origem_id, numero_doc,
  parcela_numero, total_parcelas, data_emissao, data_vencimento,
  valor_original, valor_recebido, status, operador_nome
)
SELECT
  v.empresa_id,
  v.cliente_id,
  COALESCE(v.cliente_nome, cl.nome),
  'carteira',
  v.id,
  'CART-' || upper(right(v.id::text, 6)),
  1, 1,
  v.created_at::date,
  v.created_at::date,
  COALESCE(
    (SELECT sum((p->>'valor')::numeric)
     FROM jsonb_array_elements(COALESCE(v.pagamentos::jsonb, '[]'::jsonb)) p
     WHERE p->>'forma' = 'carteira'),
    v.total
  ),
  0,
  'aberto',
  v.operador_nome
FROM vendas v
LEFT JOIN clientes cl ON cl.id = v.cliente_id
WHERE v.cliente_id IS NOT NULL
  AND (v.forma_pagamento = 'carteira'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v.pagamentos::jsonb, '[]'::jsonb)) p
                  WHERE p->>'forma' = 'carteira'))
  AND NOT EXISTS (SELECT 1 FROM contas_receber c
                  WHERE c.origem_id = v.id AND c.origem = 'carteira');


-- ============================================================
-- ETAPA 3 — RECALCULAR O SALDO DEVEDOR DE TODOS OS CLIENTES
--
-- Recalcula a partir das contas em aberto, em vez de somar o que faltou.
-- É a diferença entre consertar e remendar: somar assume que o saldo de hoje
-- está certo, e ele não está — parte veio de contas que nunca existiram,
-- parte de cadastros que acabaram de ser unificados. Recalcular é
-- idempotente e pode rodar de novo sem estragar nada.
-- ============================================================

UPDATE clientes c SET
  saldo_devedor = COALESCE((
    SELECT sum(cr.valor_original - COALESCE(cr.valor_recebido, 0))
    FROM contas_receber cr
    WHERE cr.cliente_id = c.id
      AND cr.status IN ('aberto', 'vencido')
  ), 0),
  updated_at = now();


-- ============================================================
-- ETAPA 4 — IMPEDIR QUE ACONTEÇA DE NOVO
--
-- Move a regra da tela para o banco. Agora vale para toda venda de carteira,
-- não importa por onde ela entre: PDV web, PDV externo, importação, API.
--
-- O `NOT EXISTS` evita duplicar quando a venda já tem conta.
-- ============================================================

CREATE OR REPLACE FUNCTION criar_conta_carteira() RETURNS trigger AS $$
DECLARE
  v_valor numeric;
BEGIN
  IF NEW.cliente_id IS NULL THEN RETURN NEW; END IF;

  -- Valor pago em carteira. Quando a forma principal é carteira e não há
  -- detalhamento em `pagamentos`, vale o total da venda.
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

  UPDATE clientes SET
    saldo_devedor = COALESCE(saldo_devedor, 0) + v_valor,
    updated_at = now()
  WHERE id = NEW.cliente_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_venda_carteira ON vendas;
CREATE TRIGGER trg_venda_carteira
  AFTER INSERT ON vendas
  FOR EACH ROW EXECUTE FUNCTION criar_conta_carteira();


-- ============================================================
-- ETAPA 5 — O QUE SOBROU PARA DECIDIR À MÃO
--
-- Vendas de carteira SEM cliente vinculado. Não dá para cobrar de ninguém, e
-- inventar um devedor seria pior do que deixar visível.
-- ============================================================

SELECT v.id, v.numero, v.created_at, v.total, v.cliente_nome, v.operador_nome
FROM vendas v
WHERE v.cliente_id IS NULL
  AND (v.forma_pagamento = 'carteira'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v.pagamentos::jsonb, '[]'::jsonb)) p
                  WHERE p->>'forma' = 'carteira'))
ORDER BY v.created_at DESC;


-- ============================================================
-- ETAPA 6 — CONFERÊNCIA FINAL
-- ============================================================

-- Deve voltar 0 vendas sem conta (fora as sem cliente da etapa 5)
SELECT count(*) AS ainda_sem_conta
FROM vendas v
WHERE v.cliente_id IS NOT NULL
  AND (v.forma_pagamento = 'carteira'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v.pagamentos::jsonb, '[]'::jsonb)) p
                  WHERE p->>'forma' = 'carteira'))
  AND NOT EXISTS (SELECT 1 FROM contas_receber c
                  WHERE c.origem_id = v.id AND c.origem = 'carteira');

-- Saldo por cliente depois do conserto
SELECT c.nome, c.saldo_devedor
FROM clientes c
WHERE c.ativo AND COALESCE(c.saldo_devedor, 0) > 0
ORDER BY c.saldo_devedor DESC;
