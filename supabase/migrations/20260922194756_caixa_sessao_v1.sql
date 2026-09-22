-- FASE 3 — A SESSÃO: O RECORTE TEMPORAL DA GAVETA.
--
-- `caixa` é duradouro: a gaveta do terminal YOGA existe há meses e vai
-- existir por anos. `caixa_sessao` é o turno: abriu 08:00 com João, fechou
-- 18:10 com R$ 2.490 contados. No dia seguinte, outra sessão, mesma gaveta.
--
-- A CONTINUIDADE FÍSICA É O PONTO INTEIRO DESTA FASE.
--
-- O ledger do caixa de PDV é a verdade sobre quanto existe naquela gaveta.
-- Tudo aqui foi desenhado para que, ao fim de um fechamento, o saldo do
-- ledger seja EXATAMENTE o dinheiro que ficou fisicamente lá — nem um
-- centavo a mais. É isso que permite a próxima sessão herdar o troco sem
-- inventar dinheiro novo.
--
-- A sequência do fechamento existe para isso:
--
--   ledger = esperado                      (antes de fechar)
--   + ajuste da diferença                  → ledger = CONTADO
--   − transferência (contado − troco)      → ledger = TROCO
--
-- O ajuste da diferença NÃO altera movimento nenhum do passado: é um
-- movimento novo, com natureza própria, que registra o fato apurado na
-- conferência. Sem ele o ledger passaria a mentir sobre a gaveta, e a
-- sessão seguinte herdaria um valor que não existe fisicamente.
--
-- DE ONDE VEM O FUNDO — três origens, e elas NÃO são a mesma coisa:
--
--   herdado     o dinheiro já estava na gaveta, vindo do fechamento
--               anterior. NÃO gera movimento: ele já está no ledger. O
--               valor não é digitado — é o saldo do caixa, derivado.
--
--   tesouraria  a tesouraria está entregando dinheiro novo. Isso é,
--               economicamente, um SUPRIMENTO: passa por
--               `transferir_caixa_v1`, com os dois movimentos de sempre.
--               Não existe segunda implementação de transferência.
--
--   manual      apareceu dinheiro sem origem rastreável — tipicamente a
--               primeira abertura de uma gaveta que já tinha troco. Gera um
--               movimento de `fundo_abertura`, com observação obrigatória.
--               É a única porta pela qual dinheiro entra sem contraparte, e
--               por isso ela é nomeada, auditada e visível no extrato.
--
-- SALDO NEGATIVO continua sem regra global, por decisão registrada em
-- `FASE-3-SESSAO-DE-CAIXA-DECISOES.md`. O esperado é calculado e devolvido;
-- se der negativo, quem lê decide. Não há bloqueio silencioso.

-- ── 1. A sessão ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS caixa_sessao (
  -- Gerado pelo CLIENTE antes do envio: é a chave de idempotência da
  -- abertura, como em `caixa_transferencia`.
  id                UUID PRIMARY KEY,

  empresa_id        UUID NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  caixa_id          UUID NOT NULL REFERENCES caixa(id) ON DELETE RESTRICT,

  status            TEXT NOT NULL CHECK (status IN ('aberta','fechada')),

  -- ── abertura ──
  aberta_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  aberta_por        UUID NOT NULL,
  -- De onde veio o dinheiro que estava na gaveta quando a sessão começou.
  fundo_origem      TEXT NOT NULL CHECK (fundo_origem IN ('herdado','tesouraria','manual')),
  fundo_inicial     NUMERIC(14,2) NOT NULL CHECK (fundo_inicial >= 0),
  -- A transferência que trouxe o fundo, quando `fundo_origem='tesouraria'`.
  fundo_transferencia_id UUID REFERENCES caixa_transferencia(id) ON DELETE RESTRICT,
  observacao_abertura    TEXT,

  -- ── fechamento ──
  fechada_em        TIMESTAMPTZ,
  fechada_por       UUID,
  valor_esperado    NUMERIC(14,2),
  valor_contado     NUMERIC(14,2) CHECK (valor_contado IS NULL OR valor_contado >= 0),
  -- contado − esperado. Positivo é sobra, negativo é falta. Fato apurado,
  -- nunca ajustado para fechar em zero.
  diferenca         NUMERIC(14,2),
  valor_mantido_troco     NUMERIC(14,2) CHECK (valor_mantido_troco IS NULL OR valor_mantido_troco >= 0),
  valor_entregue_tesouraria NUMERIC(14,2) CHECK (valor_entregue_tesouraria IS NULL OR valor_entregue_tesouraria >= 0),
  -- A sangria final, quando sobrou dinheiro para entregar.
  fechamento_transferencia_id UUID REFERENCES caixa_transferencia(id) ON DELETE RESTRICT,
  observacao_fechamento   TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Uma sessão fechada tem os campos do fechamento; uma aberta não tem
  -- nenhum. Sem isto, um fechamento parcial passaria despercebido.
  CONSTRAINT caixa_sessao_fechamento_completo CHECK (
    (status = 'aberta'  AND fechada_em IS NULL AND fechada_por IS NULL
       AND valor_contado IS NULL AND valor_esperado IS NULL AND diferenca IS NULL)
    OR
    (status = 'fechada' AND fechada_em IS NOT NULL AND fechada_por IS NOT NULL
       AND valor_contado IS NOT NULL AND valor_esperado IS NOT NULL AND diferenca IS NOT NULL
       AND valor_mantido_troco IS NOT NULL AND valor_entregue_tesouraria IS NOT NULL)
  ),

  -- O fundo da tesouraria tem transferência; as outras origens, não.
  CONSTRAINT caixa_sessao_fundo_coerente CHECK (
    (fundo_origem = 'tesouraria' AND fundo_transferencia_id IS NOT NULL)
    OR (fundo_origem <> 'tesouraria' AND fundo_transferencia_id IS NULL)
  )
);

COMMENT ON TABLE caixa_sessao IS
  'O período operacional de uma gaveta de PDV. Append-only: abrir e fechar '
  'são os únicos eventos, e o fechamento é uma transação só.';

-- A REGRA FUNDAMENTAL, no banco e não na aplicação: uma gaveta não tem duas
-- sessões abertas. Duas abertas fariam o saldo esperado ser calculado sobre
-- um período ambíguo, e dois operadores responderiam pelo mesmo dinheiro.
CREATE UNIQUE INDEX IF NOT EXISTS idx_caixa_sessao_uma_aberta_por_caixa
  ON caixa_sessao (caixa_id) WHERE status = 'aberta';

CREATE INDEX IF NOT EXISTS idx_caixa_sessao_caixa
  ON caixa_sessao (caixa_id, aberta_em DESC);
CREATE INDEX IF NOT EXISTS idx_caixa_sessao_empresa
  ON caixa_sessao (empresa_id, aberta_em DESC);

-- ── 2. O vínculo dos eventos com a sessão ─────────────────────────────────
--
-- NULLABLE de propósito. Os movimentos e transferências da Fase 2 nasceram
-- antes de existir sessão e continuam válidos — inclusive os dois da
-- homologação. E transferência administrativa fora de sessão segue
-- permitida durante a transição (decisão registrada em
-- `FASE-3-SESSAO-DE-CAIXA-DECISOES.md`).
ALTER TABLE caixa_movimento
  ADD COLUMN IF NOT EXISTS sessao_id UUID REFERENCES caixa_sessao(id) ON DELETE RESTRICT;
ALTER TABLE caixa_transferencia
  ADD COLUMN IF NOT EXISTS sessao_id UUID REFERENCES caixa_sessao(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_caixa_movimento_sessao
  ON caixa_movimento (sessao_id) WHERE sessao_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_caixa_transferencia_sessao
  ON caixa_transferencia (sessao_id) WHERE sessao_id IS NOT NULL;

-- ── 3. Naturezas que a Fase 3 produz ──────────────────────────────────────
--
-- Só duas, e as duas gravam algo hoje. `venda_dinheiro`,
-- `recebimento_dinheiro`, `devolucao_dinheiro` e `pagamento_dinheiro` NÃO
-- entram aqui: nada as produz ainda, e o motor de cálculo já sabe
-- classificá-las quando existirem. Estender um CHECK depois é barato; ter
-- um valor aceito que nada grava é dívida silenciosa.
ALTER TABLE caixa_movimento DROP CONSTRAINT IF EXISTS caixa_movimento_natureza_check;
ALTER TABLE caixa_movimento ADD CONSTRAINT caixa_movimento_natureza_check
  CHECK (natureza IN (
    'aporte','retirada_socio','deposito_banco','ajuste',
    'sangria','sangria_recebida','suprimento_entregue','suprimento',
    -- Dinheiro que já estava na gaveta e entra no ledger pela primeira vez.
    -- A única porta sem contraparte — nomeada para ser auditável.
    'fundo_abertura',
    -- Sobra ou falta apurada na conferência. Fato, não correção do passado.
    'diferenca_fechamento'
  ));

-- ── 4. A identidade do terminal deixa de poder evaporar ───────────────────
--
-- Dívida 5 da Fase 2: `ON DELETE SET NULL` faria um caixa com histórico
-- financeiro perder a identidade se alguém apagasse o terminal. Nenhuma
-- rota do sistema apaga terminal (são revogados por UPDATE), então trocar
-- para RESTRICT não altera comportamento existente — só fecha a porta.
ALTER TABLE caixa DROP CONSTRAINT IF EXISTS caixa_terminal_id_fkey;
ALTER TABLE caixa ADD CONSTRAINT caixa_terminal_id_fkey
  FOREIGN KEY (terminal_id) REFERENCES pdv_terminais(id) ON DELETE RESTRICT;

-- ── 5. `transferir_caixa_v1` passa a aceitar a sessão ─────────────────────
--
-- Mudança compatível: `sessao_id` é opcional e nulo por omissão. Quem a
-- chama sem sessão continua funcionando exatamente como na Fase 2 — é o
-- caso da transferência administrativa.
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
  v_sessao      UUID;
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
  v_sessao  := nullif(p->>'sessao_id','')::UUID;

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

  PERFORM pg_advisory_xact_lock(hashtextextended(v_id::text, 0));

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

  -- A sessão informada tem de ser do MESMO caixa de PDV que participa da
  -- transferência. Sem isto, um sessao_id de outra gaveta entraria no
  -- demonstrativo de fechamento errado.
  IF v_sessao IS NOT NULL THEN
    PERFORM 1 FROM caixa_sessao s
     WHERE s.id = v_sessao AND s.empresa_id = v_empresa
       AND s.caixa_id = CASE WHEN v_especie = 'sangria' THEN v_origem ELSE v_destino END;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('estado','sessao_invalida',
        'motivo','a sessão informada não é deste caixa');
    END IF;
  END IF;

  INSERT INTO caixa_transferencia
    (id, empresa_id, caixa_origem_id, caixa_destino_id, especie, valor, observacao,
     usuario_id, estorno_de_id, fingerprint, sessao_id)
  VALUES
    (v_id, v_empresa, v_origem, v_destino, v_especie, v_valor, v_obs,
     v_usuario, nullif(p->>'estorno_de_id','')::UUID, v_fp, v_sessao);

  INSERT INTO caixa_movimento
    (caixa_id, empresa_id, tipo, natureza, valor, observacao, usuario_id,
     contraparte_caixa_id, transferencia_id, sessao_id)
  VALUES
    (v_origem, v_empresa, 'saida', v_nat_saida, v_valor, v_obs, v_usuario, v_destino, v_id,
     CASE WHEN v_especie = 'sangria' THEN v_sessao ELSE NULL END),
    (v_destino, v_empresa, 'entrada', v_nat_entrada, v_valor, v_obs, v_usuario, v_origem, v_id,
     CASE WHEN v_especie = 'suprimento' THEN v_sessao ELSE NULL END);

  RETURN jsonb_build_object('estado','aplicada','transferencia_id', v_id,
    'especie', v_especie, 'valor', v_valor,
    'caixa_origem_id', v_origem, 'caixa_destino_id', v_destino);
END;
$$;

-- ── 6. O saldo do caixa — sempre somado, nunca guardado ───────────────────
CREATE OR REPLACE FUNCTION saldo_caixa_v1(p_caixa UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(sum(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END), 0)::NUMERIC(14,2)
  FROM caixa_movimento WHERE caixa_id = p_caixa;
$$;

-- ── 7. Abertura ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION abrir_caixa_sessao_v1(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id       UUID;
  v_empresa  UUID;
  v_caixa    UUID;
  v_usuario  UUID;
  v_origem   TEXT;
  v_valor    NUMERIC;
  v_obs      TEXT;
  v_transf   UUID;
  v_existe   caixa_sessao%ROWTYPE;
  v_aberta   UUID;
  v_tipo     TEXT;
  v_emp      UUID;
  v_ativo    BOOLEAN;
  v_saldo    NUMERIC;
  v_tes      UUID;
  v_r        JSONB;
BEGIN
  v_id      := nullif(p->>'id','')::UUID;
  v_empresa := nullif(p->>'empresa_id','')::UUID;
  v_caixa   := nullif(p->>'caixa_id','')::UUID;
  v_usuario := nullif(p->>'usuario_id','')::UUID;
  v_origem  := p->>'fundo_origem';
  v_valor   := round(coalesce(nullif(p->>'fundo_inicial','')::NUMERIC, 0), 2);
  v_obs     := nullif(btrim(coalesce(p->>'observacao','')), '');
  v_transf  := nullif(p->>'transferencia_id','')::UUID;

  IF v_id IS NULL OR v_empresa IS NULL OR v_caixa IS NULL OR v_usuario IS NULL THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','campos obrigatórios ausentes');
  END IF;
  IF v_origem IS NULL OR v_origem NOT IN ('herdado','tesouraria','manual') THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','origem do fundo inválida');
  END IF;
  IF v_valor < 0 THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','fundo não pode ser negativo');
  END IF;
  -- Dinheiro entrando sem contraparte exige justificativa escrita. É a
  -- diferença entre "apareceu troco na gaveta" e um lançamento anônimo.
  IF v_origem = 'manual' AND v_valor > 0 AND v_obs IS NULL THEN
    RETURN jsonb_build_object('estado','payload_invalido',
      'motivo','fundo manual exige observação explicando a origem do dinheiro');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_id::text, 0));

  -- Retry da mesma abertura.
  SELECT * INTO v_existe FROM caixa_sessao WHERE id = v_id;
  IF FOUND THEN
    RETURN jsonb_build_object('estado','ja_aberta','sessao_id', v_id,
      'status', v_existe.status, 'fundo_inicial', v_existe.fundo_inicial);
  END IF;

  SELECT tipo, empresa_id, ativo INTO v_tipo, v_emp, v_ativo FROM caixa WHERE id = v_caixa;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('estado','caixa_invalido','motivo','caixa não existe');
  END IF;
  IF v_emp <> v_empresa THEN
    RETURN jsonb_build_object('estado','empresas_diferentes','motivo','o caixa é de outra empresa');
  END IF;
  IF v_tipo <> 'pdv' THEN
    RETURN jsonb_build_object('estado','caixa_invalido','motivo','só caixa de PDV tem sessão');
  END IF;
  IF NOT v_ativo THEN
    RETURN jsonb_build_object('estado','caixa_invalido','motivo','caixa inativo não abre sessão');
  END IF;

  -- Trava também pelo CAIXA: duas aberturas simultâneas com ids diferentes
  -- não disputariam a trava do id, e as duas passariam pela checagem abaixo
  -- para colidir no índice único — erro em vez de resposta clara.
  PERFORM pg_advisory_xact_lock(hashtextextended('caixa_sessao:' || v_caixa::text, 0));

  SELECT id INTO v_aberta FROM caixa_sessao WHERE caixa_id = v_caixa AND status = 'aberta';
  IF FOUND THEN
    RETURN jsonb_build_object('estado','ja_existe_sessao_aberta',
      'motivo','este caixa já tem uma sessão aberta', 'sessao_id', v_aberta);
  END IF;

  v_saldo := saldo_caixa_v1(v_caixa);

  IF v_origem = 'herdado' THEN
    -- O valor NÃO é digitado: é o que ficou na gaveta, e o ledger sabe
    -- quanto é. Aceitar um número arbitrário aqui seria criar dinheiro.
    IF v_valor <> v_saldo THEN
      RETURN jsonb_build_object('estado','fundo_herdado_divergente',
        'motivo','o fundo herdado é o saldo que ficou na gaveta',
        'saldo_real', v_saldo, 'informado', v_valor);
    END IF;
  ELSIF v_origem = 'tesouraria' THEN
    IF v_valor <= 0 THEN
      RETURN jsonb_build_object('estado','payload_invalido',
        'motivo','fundo vindo da tesouraria precisa de valor maior que zero');
    END IF;
    IF v_transf IS NULL THEN
      RETURN jsonb_build_object('estado','payload_invalido',
        'motivo','fundo da tesouraria exige identificador de transferência');
    END IF;
  END IF;

  -- A SESSÃO NASCE ANTES DOS EFEITOS. As duas origens que produzem
  -- movimento apontam para ela por FK, então a linha precisa existir
  -- primeiro. Tudo na mesma transação: se o fundo falhar, a sessão não
  -- fica aberta.
  INSERT INTO caixa_sessao
    (id, empresa_id, caixa_id, status, aberta_por, fundo_origem, fundo_inicial,
     fundo_transferencia_id, observacao_abertura)
  VALUES
    (v_id, v_empresa, v_caixa, 'aberta', v_usuario, v_origem, v_valor,
     CASE WHEN v_origem = 'tesouraria' THEN v_transf ELSE NULL END, v_obs);

  IF v_origem = 'tesouraria' THEN
    SELECT id INTO v_tes FROM caixa WHERE empresa_id = v_empresa AND tipo = 'tesouraria';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('estado','caixa_invalido','motivo','a empresa não tem tesouraria');
    END IF;
    -- O MESMO motor da Fase 2. Não existe segunda implementação de
    -- transferência neste sistema.
    v_r := transferir_caixa_v1(jsonb_build_object(
      'id', v_transf, 'empresa_id', v_empresa,
      'caixa_origem_id', v_tes, 'caixa_destino_id', v_caixa,
      'especie', 'suprimento', 'valor', v_valor::text,
      'observacao', coalesce(v_obs, 'Fundo de abertura do caixa'),
      'usuario_id', v_usuario, 'sessao_id', v_id));
    IF v_r->>'estado' NOT IN ('aplicada','ja_aplicada') THEN
      RETURN jsonb_build_object('estado','falha_no_fundo',
        'motivo', coalesce(v_r->>'motivo', v_r->>'estado'), 'detalhe', v_r);
    END IF;

  ELSIF v_origem = 'manual' AND v_valor > 0 THEN
    INSERT INTO caixa_movimento
      (caixa_id, empresa_id, tipo, natureza, valor, observacao, usuario_id, sessao_id)
    VALUES (v_caixa, v_empresa, 'entrada', 'fundo_abertura', v_valor, v_obs, v_usuario, v_id);
  END IF;

  RETURN jsonb_build_object('estado','aberta','sessao_id', v_id,
    'caixa_id', v_caixa, 'fundo_origem', v_origem, 'fundo_inicial', v_valor,
    'saldo_na_abertura', saldo_caixa_v1(v_caixa));
END;
$$;

-- ── 8. Fechamento ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fechar_caixa_sessao_v1(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sessao   UUID;
  v_empresa  UUID;
  v_usuario  UUID;
  v_contado  NUMERIC;
  v_troco    NUMERIC;
  v_obs      TEXT;
  v_transf   UUID;
  v_visto    NUMERIC;
  s          caixa_sessao%ROWTYPE;
  v_esperado NUMERIC;
  v_dif      NUMERIC;
  v_entregar NUMERIC;
  v_tes      UUID;
  v_r        JSONB;
BEGIN
  v_sessao  := nullif(p->>'sessao_id','')::UUID;
  v_empresa := nullif(p->>'empresa_id','')::UUID;
  v_usuario := nullif(p->>'usuario_id','')::UUID;
  v_contado := round(nullif(p->>'valor_contado','')::NUMERIC, 2);
  v_troco   := round(coalesce(nullif(p->>'valor_mantido_troco','')::NUMERIC, 0), 2);
  v_obs     := nullif(btrim(coalesce(p->>'observacao','')), '');
  v_transf  := nullif(p->>'transferencia_id','')::UUID;
  v_visto   := round(nullif(p->>'valor_esperado_visto','')::NUMERIC, 2);

  IF v_sessao IS NULL OR v_empresa IS NULL OR v_usuario IS NULL OR v_contado IS NULL THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','campos obrigatórios ausentes');
  END IF;
  IF v_contado < 0 OR v_troco < 0 THEN
    RETURN jsonb_build_object('estado','payload_invalido','motivo','valores não podem ser negativos');
  END IF;
  IF v_troco > v_contado THEN
    RETURN jsonb_build_object('estado','payload_invalido',
      'motivo','não é possível manter mais troco do que o dinheiro contado');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('caixa_sessao:' || v_sessao::text, 0));

  SELECT * INTO s FROM caixa_sessao WHERE id = v_sessao AND empresa_id = v_empresa;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('estado','nao_encontrada','motivo','sessão não existe nesta empresa');
  END IF;
  IF s.status = 'fechada' THEN
    -- Retry do mesmo fechamento: devolve o que já foi apurado, sem
    -- transferir nada de novo.
    RETURN jsonb_build_object('estado','ja_fechada','sessao_id', v_sessao,
      'valor_esperado', s.valor_esperado, 'valor_contado', s.valor_contado,
      'diferenca', s.diferenca, 'valor_mantido_troco', s.valor_mantido_troco,
      'valor_entregue_tesouraria', s.valor_entregue_tesouraria);
  END IF;

  -- O ESPERADO É O LEDGER. Tudo que entrou e saiu daquela gaveta já está
  -- somado ali: fundo, suprimentos, sangrias — e, quando a integração
  -- vier, vendas e recebimentos em dinheiro.
  v_esperado := saldo_caixa_v1(s.caixa_id);

  -- Se a tela mostrou outro número, alguém movimentou o caixa enquanto o
  -- operador contava. Fechar com base no valor velho produziria uma
  -- diferença que não é real.
  IF v_visto IS NOT NULL AND v_visto <> v_esperado THEN
    RETURN jsonb_build_object('estado','conflito_esperado',
      'motivo','o caixa foi movimentado enquanto a conferência era feita',
      'esperado_agora', v_esperado, 'esperado_visto', v_visto);
  END IF;

  v_dif := round(v_contado - v_esperado, 2);

  -- 1. A diferença vira movimento — um FATO NOVO, nunca alteração do
  --    passado. Depois dele, o ledger diz exatamente o que foi contado.
  IF v_dif <> 0 THEN
    INSERT INTO caixa_movimento
      (caixa_id, empresa_id, tipo, natureza, valor, observacao, usuario_id, sessao_id)
    VALUES (s.caixa_id, v_empresa,
            CASE WHEN v_dif > 0 THEN 'entrada' ELSE 'saida' END,
            'diferenca_fechamento', abs(v_dif),
            coalesce(v_obs, '') ||
              CASE WHEN v_dif > 0 THEN ' [sobra no fechamento]' ELSE ' [falta no fechamento]' END,
            v_usuario, v_sessao);
  END IF;

  -- 2. O que sai da gaveta agora é o que AINDA ESTÁ nela: contado − troco.
  --    Não se soma sangria do dia: aquele dinheiro já saiu da gaveta e já
  --    entrou na tesouraria quando a sangria foi feita. Somar de novo seria
  --    transferir duas vezes o mesmo dinheiro.
  v_entregar := round(v_contado - v_troco, 2);

  IF v_entregar > 0 THEN
    IF v_transf IS NULL THEN
      RETURN jsonb_build_object('estado','payload_invalido',
        'motivo','entrega à tesouraria exige identificador de transferência');
    END IF;
    SELECT id INTO v_tes FROM caixa WHERE empresa_id = v_empresa AND tipo = 'tesouraria';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('estado','caixa_invalido','motivo','a empresa não tem tesouraria');
    END IF;
    -- Sangria: dinheiro saindo da gaveta para a tesouraria. É exatamente o
    -- que uma sangria é, e reusar o motor mantém uma implementação só.
    v_r := transferir_caixa_v1(jsonb_build_object(
      'id', v_transf, 'empresa_id', v_empresa,
      'caixa_origem_id', s.caixa_id, 'caixa_destino_id', v_tes,
      'especie', 'sangria', 'valor', v_entregar::text,
      'observacao', coalesce(v_obs, 'Fechamento de caixa'),
      'usuario_id', v_usuario, 'sessao_id', v_sessao));
    IF v_r->>'estado' NOT IN ('aplicada','ja_aplicada') THEN
      -- Erro aqui aborta tudo: a sessão NÃO fecha com a entrega pendente.
      RETURN jsonb_build_object('estado','falha_na_entrega',
        'motivo', coalesce(v_r->>'motivo', v_r->>'estado'), 'detalhe', v_r);
    END IF;
  END IF;

  UPDATE caixa_sessao SET
    status = 'fechada', fechada_em = now(), fechada_por = v_usuario,
    valor_esperado = v_esperado, valor_contado = v_contado, diferenca = v_dif,
    valor_mantido_troco = v_troco, valor_entregue_tesouraria = v_entregar,
    fechamento_transferencia_id = CASE WHEN v_entregar > 0 THEN v_transf ELSE NULL END,
    observacao_fechamento = v_obs
  WHERE id = v_sessao;

  RETURN jsonb_build_object('estado','fechada','sessao_id', v_sessao,
    'valor_esperado', v_esperado, 'valor_contado', v_contado, 'diferenca', v_dif,
    'valor_mantido_troco', v_troco, 'valor_entregue_tesouraria', v_entregar,
    -- A prova da continuidade: o que o ledger diz que ficou na gaveta tem
    -- de ser exatamente o troco.
    'saldo_final_do_caixa', saldo_caixa_v1(s.caixa_id));
END;
$$;

-- ── 9. RLS e grants — o mesmo tratamento do resto do Caixa ────────────────
ALTER TABLE caixa_sessao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS caixa_sessao_leitura ON caixa_sessao;
CREATE POLICY caixa_sessao_leitura ON caixa_sessao
  FOR SELECT TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

DROP POLICY IF EXISTS caixa_sessao_insercao ON caixa_sessao;
CREATE POLICY caixa_sessao_insercao ON caixa_sessao
  FOR INSERT TO authenticated
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- UPDATE existe porque fechar é um UPDATE na própria sessão. É a única
-- exceção ao append-only nesta família de tabelas, e ela é estreita: o
-- CHECK `caixa_sessao_fechamento_completo` impede que um UPDATE deixe a
-- linha num estado pela metade, e a RPC é o único caminho que a aplicação
-- usa. DELETE continua sem policy e sem grant.
DROP POLICY IF EXISTS caixa_sessao_fechamento ON caixa_sessao;
CREATE POLICY caixa_sessao_fechamento ON caixa_sessao
  FOR UPDATE TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

REVOKE ALL ON TABLE caixa_sessao FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE caixa_sessao TO authenticated;
REVOKE DELETE, TRUNCATE ON TABLE caixa_sessao FROM authenticated;

REVOKE ALL ON FUNCTION abrir_caixa_sessao_v1(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION fechar_caixa_sessao_v1(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION saldo_caixa_v1(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION abrir_caixa_sessao_v1(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fechar_caixa_sessao_v1(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION saldo_caixa_v1(UUID) TO authenticated, service_role;
