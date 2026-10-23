-- A devolução que a loja paga: de onde saiu o dinheiro.
--
-- ── POR QUE ISTO NÃO DÁ PARA DEDUZIR ─────────────────────────────────────
--
-- Em `vendas`, uma troca que fecha a favor do cliente vira uma linha com
-- `forma_pagamento = 'devolucao'` e total negativo. Medido em 22/10/2026: 12
-- em 60 dias, de R$ 0,24 a R$ 54,90.
--
-- Essa linha NÃO guarda duas coisas que a conta precisa:
--
--   1. a forma de pagamento da compra original;
--   2. o que o operador combinou com o cliente na hora.
--
-- E o dono da loja foi claro sobre a segunda: "depende da negociação, deixar
-- crédito na conta do cliente ou devolver dinheiro e sair do caixa". É uma
-- DECISÃO humana, tomada no balcão, caso a caso. Não é dado que exista em
-- lugar nenhum para eu inferir.
--
-- Adivinhar aqui gravaria saída de dinheiro que não houve, ou deixaria de
-- gravar a que houve. As duas quebram o fechamento, e a segunda em silêncio.
--
-- ── E CRÉDITO SÓ EXISTE COM CLIENTE ──────────────────────────────────────
--
-- A maioria das devoluções é do cliente "balcao", que é o anônimo. Sem cliente
-- identificado não há a quem creditar — na prática, essas saem da gaveta. Mas
-- "na prática" não é "sempre", e por isso a escolha continua sendo de quem
-- fecha o caixa, não minha.
--
-- ── O QUE ESTA TABELA É, E O QUE NÃO É ───────────────────────────────────
--
-- É o registro de UMA decisão por devolução, com quem decidiu e quando.
--
-- NÃO cria crédito de cliente: isso tem fluxo próprio, e criar em silêncio
-- daria saldo a alguém sem ninguém ter mandado. Quando o destino é crédito,
-- esta tabela só anota que a devolução foi resolvida assim -- o crédito em si
-- é lançado onde já se lança.
--
-- Quando o destino é dinheiro, aí sim o lançamento no caixa é feito, pela
-- função abaixo, com a mesma trava de unicidade de origem que a venda usa.

CREATE TABLE IF NOT EXISTS devolucao_destino (
  venda_id uuid PRIMARY KEY,
  empresa_id uuid NOT NULL,

  -- 'dinheiro'  saiu da gaveta do terminal -> lança no caixa
  -- 'credito'   virou saldo do cliente     -> não mexe no caixa
  destino text NOT NULL,

  -- O movimento gerado, quando o destino foi dinheiro. Nulo para crédito.
  -- Guardar o id é o que permite responder "este lançamento veio de qual
  -- decisão" sem procurar por valor e data.
  movimento_id uuid REFERENCES caixa_movimento(id),

  decidido_por uuid,
  decidido_em timestamptz NOT NULL DEFAULT now(),
  observacao text,

  CONSTRAINT devolucao_destino_valor_check
    CHECK (destino = ANY (ARRAY['dinheiro'::text, 'credito'::text])),

  -- Crédito não gera movimento de caixa, e dinheiro sem movimento é decisão
  -- pela metade. A trava impede os dois estados incoerentes.
  CONSTRAINT devolucao_destino_coerente
    CHECK ((destino = 'credito' AND movimento_id IS NULL)
        OR (destino = 'dinheiro'))
);

CREATE INDEX IF NOT EXISTS idx_devolucao_destino_empresa
  ON devolucao_destino (empresa_id, decidido_em DESC);

ALTER TABLE devolucao_destino ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS devolucao_destino_leitura ON devolucao_destino;
CREATE POLICY devolucao_destino_leitura ON devolucao_destino
  FOR SELECT TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

DROP POLICY IF EXISTS devolucao_destino_insercao ON devolucao_destino;
CREATE POLICY devolucao_destino_insercao ON devolucao_destino
  FOR INSERT TO authenticated
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- Sem UPDATE e sem DELETE, pelo mesmo motivo do extrato: decisão registrada é
-- histórico. Se alguém errou, a correção é um lançamento de ajuste no caixa,
-- que fica visível -- e não apagar o que foi decidido, que não fica.
REVOKE ALL ON TABLE devolucao_destino FROM anon;

-- SECURITY DEFINER pelo mesmo motivo de `venda_lanca_no_caixa_v1`:
-- `caixa_movimento` só aceita INSERT de `authenticated`, e a policy é por
-- grupo de empresa. A função confere a empresa ANTES, pela venda.
CREATE OR REPLACE FUNCTION devolucao_decidir_v1(p jsonb)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_venda    uuid := (p->>'venda_id')::uuid;
  v_destino  text := p->>'destino';
  v_usuario  uuid := nullif(p->>'usuario_id','')::uuid;
  v_obs      text := nullif(p->>'observacao','');
  v          record;
  v_caixa    uuid;
  v_mov      uuid;
BEGIN
  IF v_destino NOT IN ('dinheiro','credito') THEN
    RAISE EXCEPTION 'destino_invalido';
  END IF;

  SELECT id, empresa_id, total, terminal_id, vendedor_id, forma_pagamento, status, created_at
    INTO v FROM vendas WHERE id = v_venda;
  IF NOT FOUND THEN RAISE EXCEPTION 'venda_nao_encontrada'; END IF;
  IF COALESCE(v.forma_pagamento,'') <> 'devolucao' THEN
    RAISE EXCEPTION 'nao_e_devolucao';
  END IF;
  IF COALESCE(v.total, 0) >= 0 THEN
    RAISE EXCEPTION 'devolucao_sem_valor_a_devolver';
  END IF;

  -- Já decidida? Devolve o que está lá, sem erro. Dois cliques na mesma linha
  -- não podem lançar duas saídas.
  IF EXISTS (SELECT 1 FROM devolucao_destino WHERE venda_id = v_venda) THEN
    RETURN (SELECT to_jsonb(d) FROM devolucao_destino d WHERE d.venda_id = v_venda);
  END IF;

  IF v_destino = 'dinheiro' THEN
    -- A gaveta do terminal que atendeu. Mesma resolução que a venda usa.
    SELECT caixa_id INTO v_caixa FROM caixa_destino_da_venda_v1(v_venda);

    IF v_caixa IS NULL THEN
      -- Devolução em dinheiro precisa de uma gaveta. Sem ela, a decisão não
      -- pode ser registrada como dinheiro: ficaria uma saída sem lugar.
      SELECT c.id INTO v_caixa
        FROM caixa c
        JOIN pdv_terminais t ON t.id = c.terminal_id
       WHERE c.empresa_id = v.empresa_id AND c.ativo
         AND t.terminal_id_legado = v.terminal_id AND t.status = 'ativo'
       LIMIT 1;
    END IF;
    IF v_caixa IS NULL THEN RAISE EXCEPTION 'terminal_sem_caixa'; END IF;

    INSERT INTO caixa_movimento (caixa_id, empresa_id, tipo, natureza, valor,
                                 referencia_tipo, referencia_id, usuario_id, observacao)
    VALUES (v_caixa, v.empresa_id, 'saida', 'estorno_venda', ABS(v.total),
            'venda', v.id, COALESCE(v_usuario, v.vendedor_id),
            'Devolucao paga em dinheiro na gaveta · venda ' || left(v.id::text, 8)
              || COALESCE(' · ' || v_obs, ''))
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_mov;

    -- ON CONFLICT silencioso: se o movimento já existia, `v_mov` fica nulo e
    -- a decisão é registrada apontando para o que já está lá.
    IF v_mov IS NULL THEN
      SELECT id INTO v_mov FROM caixa_movimento
       WHERE referencia_tipo='venda' AND referencia_id = v.id
         AND natureza='estorno_venda' AND caixa_id = v_caixa LIMIT 1;
    END IF;
  END IF;

  INSERT INTO devolucao_destino (venda_id, empresa_id, destino, movimento_id,
                                 decidido_por, observacao)
  VALUES (v_venda, v.empresa_id, v_destino, v_mov, v_usuario, v_obs);

  RETURN (SELECT to_jsonb(d) FROM devolucao_destino d WHERE d.venda_id = v_venda);
END;
$$;

COMMENT ON FUNCTION devolucao_decidir_v1 IS
  'Registra para onde foi o dinheiro de uma devolucao e, quando foi a gaveta, lanca a saida no caixa do terminal. Idempotente: decidir duas vezes devolve a decisao existente sem lancar de novo.';

COMMENT ON TABLE devolucao_destino IS
  'Uma decisao por devolucao: dinheiro da gaveta ou credito do cliente. Existe porque o PDV nao grava a forma original nem a escolha do operador, e adivinhar gravaria saida que nao houve -- ou deixaria de gravar a que houve, em silencio.';
