-- FASE 4C.1 — O PAGAMENTO VIRA ENTIDADE.
--
-- Até aqui o pagamento morava em três colunas de `vendas`:
-- `forma_pagamento`, `valor_pago` e `troco`. Uma forma por venda. O PDV Web
-- já monta um array de formas e grava em `vendas.pagamentos jsonb`, mas o
-- jsonb não tem tipo, não tem chave e não tem garantia nenhuma — há em
-- produção um valor gravado como 197.32000000000002, erro de ponto
-- flutuante que `numeric(14,2)` não deixaria existir.
--
-- A decisão está em ADR-001. O resumo: idempotência por pagamento, estorno
-- individual append-only e o vínculo com o ledger precisam de uma linha com
-- PK própria. Este projeto já resolveu o mesmo problema três vezes — venda
-- v1, transferência, sessão — e as três com PK do cliente mais garantia no
-- banco.
--
-- NADA ESCREVE NESTA TABELA AINDA. A ingestão vem na 4C.2; a integração com
-- o ledger, na 4E. Esta migration cria a estrutura e a projeção, e mais
-- nada.
--
-- O QUE ELA NÃO FAZ, de propósito:
--   • não altera `vendas`, seus triggers, suas policies ou seus grants;
--   • não faz backfill — ver o relatório da 4C.1 para a classificação;
--   • não cria movimento de caixa nem toca nas Fases 1–3;
--   • não reserva coluna `caixa_movimento_id`. Quem aponta é o ledger, pelo
--     par `referencia_tipo`/`referencia_id` que a Fase 1 já criou. Assim
--     `venda_pagamento` continua append-only de verdade: não precisa de
--     UPDATE para registrar que virou movimento.

-- ── 1. A entidade ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS venda_pagamento (
  -- Gerado na ORIGEM — pelo terminal, antes de sair da máquina. É a chave de
  -- idempotência: retry, timeout e reenvio de fila mandam o mesmo id.
  --
  -- Não se usa (venda_id, forma, valor) como identidade: uma venda pode
  -- legitimamente ter dois cartões de R$ 50, e eles são pagamentos
  -- diferentes.
  id                    UUID PRIMARY KEY,

  venda_id              UUID NOT NULL REFERENCES vendas(id) ON DELETE RESTRICT,

  -- DERIVADO da venda por trigger, nunca aceito do payload. `vendas` tem RLS
  -- desligada e `anon` com INSERT (dívida técnica 4), então confiar num
  -- empresa_id enviado seria abrir uma porta que o resto do módulo fechou.
  empresa_id            UUID,

  -- A lista canônica é `src/lib/pdv/formasPagamento.ts`. Os três últimos são
  -- legado observado em produção e entram para não recusar o que já existe:
  -- `devolucao` e `marketplace` aparecem em vendas reais, `fiado` está na
  -- lista canônica mas ainda não foi usado.
  forma                 TEXT NOT NULL CHECK (forma IN (
                          'dinheiro','debito','credito','pix','carteira','fiado',
                          'devolucao','marketplace','credito_cliente')),

  -- O valor APLICADO à venda — nunca o que o cliente entregou.
  valor                 NUMERIC(14,2) NOT NULL CHECK (valor > 0),

  -- Só fazem sentido em espécie. Para cartão e PIX ficam nulos: inventar
  -- "entregue = valor" criaria um troco de zero que nunca existiu.
  valor_entregue        NUMERIC(14,2),
  troco                 NUMERIC(14,2),

  -- Ordem em que o operador compôs o pagamento. Serve à impressão e ao
  -- extrato; não é identidade.
  sequencia             SMALLINT NOT NULL DEFAULT 1 CHECK (sequencia > 0),

  -- De onde veio. Distinguir a origem é o que permitirá, na 4C.2, aceitar
  -- payload legado sem fabricar decomposição.
  origem                TEXT NOT NULL DEFAULT 'api'
                          CHECK (origem IN ('pdv_electron','pdv_web','api','backfill')),

  -- Preenchidos quando houver (4D/4E). Nulos não são defeito: o Modelo A
  -- recebe no próprio terminal, e nem toda venda passa por sessão.
  terminal_recebedor_id UUID REFERENCES pdv_terminais(id) ON DELETE RESTRICT,
  usuario_id            UUID,
  sessao_id             UUID REFERENCES caixa_sessao(id) ON DELETE RESTRICT,

  -- Append-only: corrigir é lançar o inverso, nunca apagar.
  estorno_de_id         UUID REFERENCES venda_pagamento(id) ON DELETE RESTRICT,

  observacao            TEXT,
  recebido_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Troco só existe onde há espécie.
  CONSTRAINT venda_pagamento_troco_so_em_dinheiro
    CHECK (troco IS NULL OR forma = 'dinheiro'),
  CONSTRAINT venda_pagamento_entregue_so_em_dinheiro
    CHECK (valor_entregue IS NULL OR forma = 'dinheiro'),

  -- Quem entrega, entrega pelo menos o que aplicou.
  CONSTRAINT venda_pagamento_entregue_cobre_aplicado
    CHECK (valor_entregue IS NULL OR valor_entregue >= valor),

  -- E o troco é a diferença — não um número solto.
  CONSTRAINT venda_pagamento_troco_coerente
    CHECK (troco IS NULL OR valor_entregue IS NULL OR troco = valor_entregue - valor)
);

COMMENT ON TABLE venda_pagamento IS
  'Um pagamento de uma venda. Append-only. A venda pode ter vários: '
  'valor é o APLICADO à venda, e só a parcela em dinheiro moverá a gaveta.';

-- NÃO existe CHECK de `SUM(valor) = vendas.total`.
--
-- Três motivos, todos medidos: `total` já traz devoluções embutidas
-- (`total_devolucoes`), há 18 vendas com total negativo, e a soma em
-- ponto flutuante do jsonb já divergiu por 2e-14 numa venda real. Um CHECK
-- de igualdade exata recusaria dados legítimos.
--
-- A regra existe, mas é da INGESTÃO: a RPC da 4C.2 valida
-- `round(sum(valor),2) = round(valor_a_pagar,2)` e recusa divergência com
-- erro explícito. Documentado no relatório da 4C.1.

CREATE INDEX IF NOT EXISTS idx_venda_pagamento_venda
  ON venda_pagamento (venda_id, sequencia);
CREATE INDEX IF NOT EXISTS idx_venda_pagamento_empresa
  ON venda_pagamento (empresa_id, recebido_em DESC);
CREATE INDEX IF NOT EXISTS idx_venda_pagamento_sessao
  ON venda_pagamento (sessao_id) WHERE sessao_id IS NOT NULL;

-- Cada pagamento só é estornado uma vez — mesmo padrão de
-- `caixa_movimento` e `caixa_transferencia`.
CREATE UNIQUE INDEX IF NOT EXISTS idx_venda_pagamento_estorno_unico
  ON venda_pagamento (estorno_de_id) WHERE estorno_de_id IS NOT NULL;

-- ── 2. A empresa vem da venda, não do payload ─────────────────────────────
CREATE OR REPLACE FUNCTION venda_pagamento_deriva_empresa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_emp UUID; v_existe BOOLEAN;
BEGIN
  SELECT empresa_id, true INTO v_emp, v_existe FROM vendas WHERE id = NEW.venda_id;
  IF NOT v_existe THEN
    RAISE EXCEPTION 'venda % não existe', NEW.venda_id USING ERRCODE = '23503';
  END IF;

  -- Sobrescreve o que veio. Não é validação, é derivação: assim a
  -- divergência entre pagamento e venda é impossível por construção, e não
  -- apenas improvável. `vendas.empresa_id` é nullable, então nulo aqui
  -- reflete a venda — não se inventa empresa.
  NEW.empresa_id := v_emp;

  -- O estorno herda a venda do original: estornar o pagamento de uma venda
  -- lançando na outra seria mover dinheiro entre documentos.
  IF NEW.estorno_de_id IS NOT NULL THEN
    PERFORM 1 FROM venda_pagamento WHERE id = NEW.estorno_de_id AND venda_id = NEW.venda_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'o pagamento estornado pertence a outra venda'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_venda_pagamento_empresa
  BEFORE INSERT ON venda_pagamento
  FOR EACH ROW EXECUTE FUNCTION venda_pagamento_deriva_empresa();

-- ── 3. A projeção — uma fonte, nunca duas ─────────────────────────────────
--
-- `vendas.pagamentos` continua existindo porque a emissão de NFC-e
-- (`emitirParaVenda.ts`), o trigger `criar_conta_carteira`, o comprovante em
-- PDF e a tela de vendas já a leem. Nenhum deles muda.
--
-- Mas ela deixa de ser escrita por quem insere e passa a ser DERIVADA da
-- tabela, por trigger, na MESMA transação. É o que torna a divergência
-- impossível: não existe o intervalo entre "gravei o pagamento" e "atualizei
-- o array" em que uma falha deixaria os dois diferentes.
--
-- O estorno é somado com sinal, então um pagamento estornado deixa de
-- aparecer no array — que é o que os consumidores esperam de "o que foi
-- efetivamente pago".
CREATE OR REPLACE FUNCTION venda_pagamento_projeta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_venda UUID; v_json JSONB;
BEGIN
  v_venda := COALESCE(NEW.venda_id, OLD.venda_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'valor', valor)
                            ORDER BY sequencia, recebido_em), '[]'::jsonb)
    INTO v_json
  FROM (
    SELECT p.forma, sum(
             CASE WHEN p.estorno_de_id IS NULL THEN p.valor ELSE -p.valor END
           ) AS valor,
           min(p.sequencia) AS sequencia, min(p.recebido_em) AS recebido_em
    FROM venda_pagamento p
    WHERE p.venda_id = v_venda
    GROUP BY p.forma
    HAVING sum(CASE WHEN p.estorno_de_id IS NULL THEN p.valor ELSE -p.valor END) <> 0
  ) agregado;

  UPDATE vendas SET pagamentos = v_json WHERE id = v_venda;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_venda_pagamento_projeta
  AFTER INSERT OR UPDATE OR DELETE ON venda_pagamento
  FOR EACH ROW EXECUTE FUNCTION venda_pagamento_projeta();

-- ── 4. RLS e grants — mais restrito que `vendas`, de propósito ────────────
--
-- `vendas` tem RLS desligada e `anon` com INSERT — é a dívida técnica 4,
-- herdada e fora do escopo desta fase. `venda_pagamento` NÃO repete isso:
-- nasce com o mesmo tratamento das tabelas do Caixa.
--
-- Consequência de contrato: o PDV legado, que escreve em `vendas` como
-- `anon`, NÃO conseguirá inserir pagamentos. E não precisa — na 4C.2 a
-- ingestão passa pela rota protegida da 0.6D.3, com token de terminal.
ALTER TABLE venda_pagamento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS venda_pagamento_leitura ON venda_pagamento;
CREATE POLICY venda_pagamento_leitura ON venda_pagamento
  FOR SELECT TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

DROP POLICY IF EXISTS venda_pagamento_insercao ON venda_pagamento;
CREATE POLICY venda_pagamento_insercao ON venda_pagamento
  FOR INSERT TO authenticated
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- Sem policy de UPDATE e sem policy de DELETE: com RLS ligada, operação sem
-- policy é negada. A ausência É a proibição — mesmo desenho da Fase 1.1.
REVOKE ALL ON TABLE venda_pagamento FROM anon;
GRANT SELECT, INSERT ON TABLE venda_pagamento TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE venda_pagamento FROM authenticated;

REVOKE ALL ON FUNCTION venda_pagamento_deriva_empresa() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION venda_pagamento_projeta() FROM PUBLIC, anon;
