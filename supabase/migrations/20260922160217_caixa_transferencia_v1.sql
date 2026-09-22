-- FASE 2 — SANGRIA E SUPRIMENTO: A TRANSFERÊNCIA É UM DOCUMENTO.
--
-- Sangria é o operador tirando dinheiro da gaveta e entregando ao
-- financeiro. Suprimento é o contrário. Nos dois casos um MESMO dinheiro sai
-- de um lugar e entra em outro — uma transferência econômica com dois lados,
-- não dois lançamentos que por acaso se anulam.
--
-- O erro a evitar tem nome: sangria que saiu do PDV e não entrou na
-- tesouraria. O dinheiro some do sistema e só reaparece na conferência
-- física, dias depois, sem ninguém saber de onde veio a diferença.
--
-- DOCUMENTO × MOVIMENTO — o mesmo princípio da Fase 1, que proíbe guardar
-- saldo em coluna:
--
--   caixa_transferencia   o documento. Nasce uma vez e nunca muda.
--   caixa_movimento       os efeitos. Exatamente dois, um em cada caixa.
--
-- Os dois movimentos carregam `transferencia_id`. Sem ele, duas
-- transferências idênticas ficariam indistinguíveis:
-- `contraparte_caixa_id`, que a Fase 1 já criou, diz PARA ONDE o dinheiro
-- foi, não DE QUAL operação ele faz parte.
--
-- IDEMPOTÊNCIA — `caixa_transferencia.id` é a chave. O cliente o gera ao
-- ABRIR o diálogo, não ao confirmar: é isso que faz o duplo clique, o
-- timeout e o refresh convergirem para a mesma operação em vez de criarem
-- três. Mesmo id com o mesmo payload devolve a transferência existente;
-- mesmo id com payload diferente é `conflito_payload`, nunca uma
-- atualização silenciosa.
--
-- O fingerprint é o que separa os dois casos. Mesmo desenho de
-- `venda_fingerprint_v1` (0.6D.2), pelo mesmo motivo: sem ele, "já existe"
-- não distingue retry legítimo de reuso de UUID com outro valor.
--
-- ESTORNO É DO DOCUMENTO INTEIRO. Estornar um movimento só desfaria metade
-- da transferência — exatamente o buraco que esta fase existe para fechar.
-- Por isso o estorno nasce como uma transferência nova, com origem e destino
-- invertidos, ligada à original por `estorno_de_id`.
--
-- SALDO NEGATIVO NÃO É TRATADO AQUI, DE PROPÓSITO. Não existe política de
-- saldo no sistema: `calcularSaldo` devolve negativo sem reclamar, nada
-- consulta saldo antes de gravar, e a Fase 1 já permite retirada maior que
-- o saldo. Bloquear agora exigiria decidir o que fazer com saldo inicial,
-- fundo de troco e concorrência — que são conceitos da Fase 3. O ledger
-- continua contabilmente consistente: o que sai de um lado entra no outro.

-- ── 1. A identidade do caixa de PDV ───────────────────────────────────────
--
-- Um caixa de PDV representa uma gaveta física. Dois caixas para o mesmo
-- terminal partiriam o saldo daquela gaveta em dois, e nenhum dos dois
-- estaria certo.
--
-- A identidade é `terminal_id`, nunca o nome: nomes mudam ("Balcão 02" vira
-- "Caixa 2") e não são únicos por construção.
--
-- O índice NÃO filtra por `ativo`. Se filtrasse, desativar um caixa
-- liberaria criar outro para a mesma gaveta, e o histórico da gaveta ficaria
-- partido entre os dois. Desativar é UPDATE em `ativo`; reativar é UPDATE de
-- volta. Um terminal tem um caixa, para sempre.
CREATE UNIQUE INDEX IF NOT EXISTS idx_caixa_pdv_um_por_terminal
  ON caixa (empresa_id, terminal_id)
  WHERE tipo = 'pdv' AND terminal_id IS NOT NULL;

-- ── 2. O documento ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS caixa_transferencia (
  -- Gerado pelo CLIENTE, antes do envio. É a chave de idempotência.
  id                UUID PRIMARY KEY,

  empresa_id        UUID NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  caixa_origem_id   UUID NOT NULL REFERENCES caixa(id) ON DELETE RESTRICT,
  caixa_destino_id  UUID NOT NULL REFERENCES caixa(id) ON DELETE RESTRICT,

  especie           TEXT NOT NULL CHECK (especie IN ('sangria','suprimento')),
  -- Sempre positivo: a direção está em `especie` e nos caixas, nunca no sinal.
  valor             NUMERIC NOT NULL CHECK (valor > 0),
  observacao        TEXT,
  usuario_id        UUID NOT NULL,

  -- Quando esta transferência é o estorno de outra.
  estorno_de_id     UUID REFERENCES caixa_transferencia(id) ON DELETE RESTRICT,

  -- Hash canônico do payload. Distingue retry legítimo de reuso de UUID.
  fingerprint       TEXT NOT NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Dinheiro não se transfere para o lugar onde já está.
  CONSTRAINT caixa_transferencia_origem_difere_destino
    CHECK (caixa_origem_id <> caixa_destino_id)
);

COMMENT ON TABLE caixa_transferencia IS
  'O documento de uma transferência física de dinheiro entre caixas. '
  'Append-only. Os dois efeitos ficam em caixa_movimento, ligados por '
  'transferencia_id.';

CREATE INDEX IF NOT EXISTS idx_caixa_transferencia_empresa
  ON caixa_transferencia (empresa_id, created_at DESC);

-- Cada transferência só é estornada uma vez. Sob concorrência, é este índice
-- que decide — a checagem em SQL antes do INSERT só existe para devolver
-- mensagem legível.
CREATE UNIQUE INDEX IF NOT EXISTS idx_caixa_transferencia_estorno_unico
  ON caixa_transferencia (estorno_de_id) WHERE estorno_de_id IS NOT NULL;

-- ── 3. O vínculo do efeito com o documento ────────────────────────────────
ALTER TABLE caixa_movimento
  ADD COLUMN IF NOT EXISTS transferencia_id UUID REFERENCES caixa_transferencia(id) ON DELETE RESTRICT;

-- No máximo um movimento por caixa por transferência. É o que impede um
-- retry parcial de produzir um terceiro efeito.
CREATE UNIQUE INDEX IF NOT EXISTS idx_caixa_movimento_transferencia_caixa
  ON caixa_movimento (transferencia_id, caixa_id) WHERE transferencia_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_caixa_movimento_transferencia
  ON caixa_movimento (transferencia_id) WHERE transferencia_id IS NOT NULL;

-- ── 4. As naturezas que a Fase 2 produz ───────────────────────────────────
--
-- Quatro, e não duas: cada lado precisa dizer o que aconteceu DAQUELE lado.
-- No extrato da tesouraria, "Sangria recebida (+)" e "Suprimento enviado (−)"
-- são frases diferentes, e o operador lê uma coluna só.
ALTER TABLE caixa_movimento DROP CONSTRAINT IF EXISTS caixa_movimento_natureza_check;
ALTER TABLE caixa_movimento ADD CONSTRAINT caixa_movimento_natureza_check
  CHECK (natureza IN (
    'aporte','retirada_socio','deposito_banco','ajuste',
    'sangria',              -- saída do PDV
    'sangria_recebida',     -- entrada na tesouraria
    'suprimento_entregue',  -- saída da tesouraria
    'suprimento'            -- entrada no PDV
  ));

-- ── 5. Fingerprint canônico ───────────────────────────────────────────────
--
-- Só os campos que definem a operação economicamente. A observação ENTRA:
-- se o texto mudou, quem chamou montou outro payload, e o certo é acusar
-- conflito em vez de gravar um e ignorar o outro.
CREATE OR REPLACE FUNCTION transferencia_fingerprint_v1(p JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
-- `digest` mora no schema `extensions` neste projeto, não em `public` —
-- por isso a chamada é qualificada em vez de depender do search_path.
SET search_path = public
AS $$
  SELECT encode(extensions.digest(
    coalesce(p->>'empresa_id','')       || '|' ||
    coalesce(p->>'caixa_origem_id','')  || '|' ||
    coalesce(p->>'caixa_destino_id','') || '|' ||
    coalesce(p->>'especie','')          || '|' ||
    -- Normalizado em centavos: 100 e 100.00 são o mesmo dinheiro.
    coalesce(to_char(round((p->>'valor')::numeric, 2), 'FM9999999990.00'), '') || '|' ||
    coalesce(btrim(p->>'observacao'),''),
    'sha256'), 'hex');
$$;

-- ── 6. A operação, numa transação só ──────────────────────────────────────
CREATE OR REPLACE FUNCTION transferir_caixa_v1(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id          UUID;
  v_empresa     UUID;
  v_origem      UUID;
  v_destino     UUID;
  v_especie     TEXT;
  v_valor       NUMERIC;
  v_obs         TEXT;
  v_usuario     UUID;
  v_fp          TEXT;
  v_existente   caixa_transferencia%ROWTYPE;
  v_tipo_o      TEXT;
  v_tipo_d      TEXT;
  v_emp_o       UUID;
  v_emp_d       UUID;
  v_ativo_o     BOOLEAN;
  v_ativo_d     BOOLEAN;
  v_nat_saida   TEXT;
  v_nat_entrada TEXT;
BEGIN
  v_id      := nullif(p->>'id','')::UUID;
  v_empresa := nullif(p->>'empresa_id','')::UUID;
  v_origem  := nullif(p->>'caixa_origem_id','')::UUID;
  v_destino := nullif(p->>'caixa_destino_id','')::UUID;
  v_especie := p->>'especie';
  v_valor   := round(nullif(p->>'valor','')::NUMERIC, 2);
  v_obs     := nullif(btrim(coalesce(p->>'observacao','')), '');
  v_usuario := nullif(p->>'usuario_id','')::UUID;

  -- 1. Identidade. Sem id não há idempotência, e sem idempotência um retry
  --    duplica dinheiro — então falta de id é recusa, não geração de um novo.
  IF v_id IS NULL OR v_empresa IS NULL OR v_origem IS NULL OR v_destino IS NULL
     OR v_usuario IS NULL OR v_valor IS NULL THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','campos obrigatórios ausentes');
  END IF;
  IF v_especie IS NULL OR v_especie NOT IN ('sangria','suprimento') THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','espécie inválida');
  END IF;
  IF v_valor <= 0 THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','valor deve ser maior que zero');
  END IF;
  IF v_origem = v_destino THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','origem e destino são o mesmo caixa');
  END IF;

  v_fp := transferencia_fingerprint_v1(jsonb_build_object(
    'empresa_id', v_empresa::text, 'caixa_origem_id', v_origem::text,
    'caixa_destino_id', v_destino::text, 'especie', v_especie,
    'valor', v_valor::text, 'observacao', coalesce(v_obs,'')));

  -- 2. Serializa esta transferência.
  --
  --    `FOR UPDATE` não serve sozinho: na primeira chamada a linha ainda não
  --    existe, então não há o que travar, e duas chamadas simultâneas com o
  --    mesmo id passariam as duas pela checagem de existência para colidir
  --    na PK — devolvendo erro em vez de `ja_aplicada`. O advisory lock é
  --    sobre o ID, exista a linha ou não. Mesma correção da 0.6D.2.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_id::text, 0));

  -- 3. Já aplicada?
  SELECT * INTO v_existente FROM caixa_transferencia WHERE id = v_id;
  IF FOUND THEN
    IF v_existente.fingerprint IS DISTINCT FROM v_fp THEN
      RETURN jsonb_build_object('estado','conflito_payload',
        'motivo','mesmo identificador já usado para outra transferência',
        'transferencia_id', v_id);
    END IF;
    RETURN jsonb_build_object('estado','ja_aplicada','transferencia_id', v_id,
      'valor', v_existente.valor, 'especie', v_existente.especie);
  END IF;

  -- 4/5. Os caixas existem, são da MESMA empresa, e a empresa é a do
  --      contexto. A RLS não basta: ela é por GRUPO, e deixaria uma
  --      transferência ligar CNPJs diferentes do mesmo grupo.
  SELECT tipo, empresa_id, ativo INTO v_tipo_o, v_emp_o, v_ativo_o FROM caixa WHERE id = v_origem;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('estado','caixa_invalido','motivo','caixa de origem não existe');
  END IF;
  SELECT tipo, empresa_id, ativo INTO v_tipo_d, v_emp_d, v_ativo_d FROM caixa WHERE id = v_destino;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('estado','caixa_invalido','motivo','caixa de destino não existe');
  END IF;

  IF v_emp_o <> v_empresa OR v_emp_d <> v_empresa THEN
    RETURN jsonb_build_object('estado','empresas_diferentes',
      'motivo','origem e destino precisam ser da empresa ativa — transferência não cruza CNPJ');
  END IF;

  IF NOT v_ativo_o OR NOT v_ativo_d THEN
    RETURN jsonb_build_object('estado','caixa_invalido','motivo','caixa inativo não movimenta');
  END IF;

  -- 6. A combinação de tipos. Banco ↔ tesouraria é fase posterior.
  IF v_especie = 'sangria' THEN
    IF v_tipo_o <> 'pdv' OR v_tipo_d <> 'tesouraria' THEN
      RETURN jsonb_build_object('estado','combinacao_invalida',
        'motivo','sangria vai de um caixa de PDV para a tesouraria');
    END IF;
    v_nat_saida := 'sangria'; v_nat_entrada := 'sangria_recebida';
  ELSE
    IF v_tipo_o <> 'tesouraria' OR v_tipo_d <> 'pdv' THEN
      RETURN jsonb_build_object('estado','combinacao_invalida',
        'motivo','suprimento vai da tesouraria para um caixa de PDV');
    END IF;
    v_nat_saida := 'suprimento_entregue'; v_nat_entrada := 'suprimento';
  END IF;

  -- 7. O documento.
  INSERT INTO caixa_transferencia
    (id, empresa_id, caixa_origem_id, caixa_destino_id, especie, valor, observacao,
     usuario_id, estorno_de_id, fingerprint)
  VALUES
    (v_id, v_empresa, v_origem, v_destino, v_especie, v_valor, v_obs,
     v_usuario, nullif(p->>'estorno_de_id','')::UUID, v_fp);

  -- 8/9. Os dois efeitos. Mesma transação: ou os dois, ou nenhum.
  INSERT INTO caixa_movimento
    (caixa_id, empresa_id, tipo, natureza, valor, observacao, usuario_id,
     contraparte_caixa_id, transferencia_id)
  VALUES
    (v_origem, v_empresa, 'saida', v_nat_saida, v_valor, v_obs, v_usuario, v_destino, v_id),
    (v_destino, v_empresa, 'entrada', v_nat_entrada, v_valor, v_obs, v_usuario, v_origem, v_id);

  RETURN jsonb_build_object('estado','aplicada','transferencia_id', v_id,
    'especie', v_especie, 'valor', v_valor,
    'caixa_origem_id', v_origem, 'caixa_destino_id', v_destino);
END;
$$;

COMMENT ON FUNCTION transferir_caixa_v1(JSONB) IS
  'Sangria/suprimento em uma transação: documento + dois movimentos. '
  'Idempotente por caixa_transferencia.id; payload diferente no mesmo id '
  'devolve conflito_payload.';

-- ── 7. Estorno — do documento, nunca de meio par ──────────────────────────
CREATE OR REPLACE FUNCTION estornar_transferencia_caixa_v1(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_alvo      UUID;
  v_novo      UUID;
  v_empresa   UUID;
  v_usuario   UUID;
  v_orig      caixa_transferencia%ROWTYPE;
  v_ja        UUID;
  v_especie   TEXT;
  v_nat_s     TEXT;
  v_nat_e     TEXT;
  v_fp        TEXT;
  v_obs       TEXT;
BEGIN
  v_alvo    := nullif(p->>'transferencia_id','')::UUID;
  v_novo    := nullif(p->>'id','')::UUID;
  v_empresa := nullif(p->>'empresa_id','')::UUID;
  v_usuario := nullif(p->>'usuario_id','')::UUID;

  IF v_alvo IS NULL OR v_novo IS NULL OR v_empresa IS NULL OR v_usuario IS NULL THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','campos obrigatórios ausentes');
  END IF;

  -- Trava pelo ALVO: dois estornos concorrentes da mesma transferência
  -- disputam esta trava, não a PK do estorno (que seria diferente em cada).
  PERFORM pg_advisory_xact_lock(hashtextextended(v_alvo::text, 0));

  SELECT * INTO v_orig FROM caixa_transferencia WHERE id = v_alvo AND empresa_id = v_empresa;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('estado','nao_encontrada',
      'motivo','transferência não existe nesta empresa');
  END IF;

  -- Estornar um estorno viraria corrente de reversões; para desfazer um
  -- estorno, lança-se a transferência original de novo.
  IF v_orig.estorno_de_id IS NOT NULL THEN
    RETURN jsonb_build_object('estado','nao_estorna_estorno',
      'motivo','um estorno não pode ser estornado');
  END IF;

  SELECT id INTO v_ja FROM caixa_transferencia WHERE estorno_de_id = v_alvo;
  IF FOUND THEN
    -- Idempotente: reenviar o mesmo pedido devolve o estorno que já existe.
    RETURN jsonb_build_object('estado','ja_estornada','transferencia_id', v_ja,
      'estorno_de_id', v_alvo);
  END IF;

  -- O estorno é a transferência inversa: origem e destino trocados, e a
  -- espécie oposta — devolver uma sangria é, economicamente, um suprimento.
  IF v_orig.especie = 'sangria' THEN
    v_especie := 'suprimento'; v_nat_s := 'suprimento_entregue'; v_nat_e := 'suprimento';
  ELSE
    v_especie := 'sangria';    v_nat_s := 'sangria';             v_nat_e := 'sangria_recebida';
  END IF;

  v_obs := 'Estorno da transferência ' || v_alvo::text
           || CASE WHEN v_orig.observacao IS NOT NULL THEN ' — ' || v_orig.observacao ELSE '' END;

  v_fp := transferencia_fingerprint_v1(jsonb_build_object(
    'empresa_id', v_empresa::text,
    'caixa_origem_id', v_orig.caixa_destino_id::text,
    'caixa_destino_id', v_orig.caixa_origem_id::text,
    'especie', v_especie, 'valor', v_orig.valor::text, 'observacao', v_obs));

  INSERT INTO caixa_transferencia
    (id, empresa_id, caixa_origem_id, caixa_destino_id, especie, valor, observacao,
     usuario_id, estorno_de_id, fingerprint)
  VALUES
    (v_novo, v_empresa, v_orig.caixa_destino_id, v_orig.caixa_origem_id, v_especie,
     v_orig.valor, v_obs, v_usuario, v_alvo, v_fp);

  INSERT INTO caixa_movimento
    (caixa_id, empresa_id, tipo, natureza, valor, observacao, usuario_id,
     contraparte_caixa_id, transferencia_id)
  VALUES
    (v_orig.caixa_destino_id, v_empresa, 'saida', v_nat_s, v_orig.valor, v_obs, v_usuario,
     v_orig.caixa_origem_id, v_novo),
    (v_orig.caixa_origem_id, v_empresa, 'entrada', v_nat_e, v_orig.valor, v_obs, v_usuario,
     v_orig.caixa_destino_id, v_novo);

  RETURN jsonb_build_object('estado','estornada','transferencia_id', v_novo,
    'estorno_de_id', v_alvo, 'valor', v_orig.valor);
END;
$$;

COMMENT ON FUNCTION estornar_transferencia_caixa_v1(JSONB) IS
  'Estorna a transferência INTEIRA, gerando o par invertido. Nunca estorna '
  'um movimento isolado, que deixaria metade do dinheiro fora do lugar.';

-- ── 8. RLS e grants — mesmo tratamento do ledger (Fase 1.1) ───────────────
ALTER TABLE caixa_transferencia ENABLE ROW LEVEL SECURITY;

-- Policies separadas por operação: com RLS ligada, operação sem policy é
-- negada, então a ausência de UPDATE e DELETE é a proibição.
DROP POLICY IF EXISTS caixa_transferencia_leitura ON caixa_transferencia;
CREATE POLICY caixa_transferencia_leitura ON caixa_transferencia
  FOR SELECT TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

DROP POLICY IF EXISTS caixa_transferencia_insercao ON caixa_transferencia;
CREATE POLICY caixa_transferencia_insercao ON caixa_transferencia
  FOR INSERT TO authenticated
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

REVOKE ALL ON TABLE caixa_transferencia FROM anon;
GRANT SELECT, INSERT ON TABLE caixa_transferencia TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE caixa_transferencia FROM authenticated;

-- As funções rodam como SECURITY INVOKER: a RLS continua valendo dentro
-- delas, como segunda camada atrás da validação explícita de empresa.
-- `anon` não executa — este ledger não tem consumidor externo.
REVOKE ALL ON FUNCTION transferir_caixa_v1(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION estornar_transferencia_caixa_v1(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION transferencia_fingerprint_v1(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION transferir_caixa_v1(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION estornar_transferencia_caixa_v1(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION transferencia_fingerprint_v1(JSONB) TO authenticated, service_role;
