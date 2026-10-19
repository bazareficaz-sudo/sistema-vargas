-- As formas de pagamento viram cadastro, com taxa por parcela e vigência.
--
-- ── O ESTADO QUE ISTO DESTRAVA ───────────────────────────────────────────
--
-- Medido em 18/10/2026. A lista de formas de pagamento do sistema não existe
-- em tabela nenhuma: é um array fixo em `src/lib/pdv/formasPagamento.ts`,
-- copiado em SETE arquivos que já divergem entre si — um tem `boleto`, outro
-- tem `transferencia`, outro não tem `fiado`. O arquivo canônico abre
-- dizendo, nas suas próprias palavras, "uma lista copiada é uma lista que
-- diverge"; ele resolveu três cópias e as outras quatro ficaram.
--
-- As taxas existem, em `saude_config`: sete colunas, uma linha por empresa,
-- sem histórico e sem prazo. O crédito parcelado é uma APROXIMAÇÃO LINEAR —
-- `taxa_credito_vista_pct + (n-1) * taxa_credito_parc_pct` — que com os
-- números reais da loja (3,04 e 2,48) dá 8,00% em 3x. Contrato de adquirente
-- não é linear: é uma tabela por número de parcelas.
--
-- E não há onde registrar PRAZO. O pix cai na hora, o débito em um dia, o
-- crédito em trinta. Sem isso o sistema sabe quanto a maquininha deve e não
-- sabe quando deveria ter caído — é o que falta para conciliar.
--
-- ── A ESCADA, E POR QUE SÓ `vigente_de` ──────────────────────────────────
--
-- As taxas do Mercado Pago mudam por negociação, com data. Guardar
-- `vigente_ate` junto criaria buracos: bastaria uma data de fim um dia antes
-- da seguinte começar para existir um dia sem taxa nenhuma.
--
-- Esse erro já aconteceu neste sistema. As faixas de saúde tinham
-- `margem_min` E `margem_max`, e os valores reais da loja (70/50/30/5)
-- deixavam vãos: 69,5% de margem não caía em faixa alguma e era classificada
-- como Prejuízo, que BLOQUEIA a venda. A correção foi tratar faixa como
-- escada — vale o degrau de baixo, e pronto.
--
-- Aqui é o mesmo: vale a vigência mais recente que já começou, e dentro dela
-- o degrau de parcela mais alto que não passa do pedido. Uma vigência é uma
-- escada COMPLETA da forma: quem muda a taxa cadastra a tabela nova inteira,
-- não um degrau solto.
--
-- ── O PDV LÊ `saude_config` COM A CHAVE ANÔNIMA ──────────────────────────
--
-- `src/main/api.js:1749` do PDV externo faz `from('saude_config')` direto, sem
-- sessão. A tabela tem RLS desligada e `anon_select`; as tabelas novas aqui
-- nascem com RLS ligada e só para `authenticated`, como `caixa`.
--
-- Se o cadastro novo fosse a única fonte, os seis terminais perderiam as taxas
-- e a saúde da venda pararia no balcão. Então o banco PROJETA: mexer na
-- escada atualiza as sete colunas de `saude_config`, e o PDV continua lendo
-- exatamente o que sempre leu. Nada de versão nova do PDV, nada de mudar
-- grant de tabela existente.
--
-- A projeção do crédito parcelado é a mesma aproximação linear de hoje
-- (1x exato, incremento = 2x menos 1x), porque é o formato que as duas
-- colunas antigas comportam. O web passa a usar a escada exata; o PDV fica
-- aproximado em 3x ou mais até ganhar versão que leia a escada. Isso é uma
-- limitação conhecida, não um descuido.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. O CADASTRO DAS FORMAS
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS forma_pagamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,

  -- `codigo` é o que já está gravado em 2.123 vendas dos últimos 60 dias
  -- (`vendas.forma_pagamento`) e travado por CHECK em `venda_pagamento.forma`.
  -- Os códigos semeados abaixo são exatamente os que o balcão já usa: renomear
  -- aqui quebraria o histórico, por isso o nome de tela é `nome`, separado.
  codigo text NOT NULL,
  nome text NOT NULL,
  icone text,
  -- Atalho no balcão (1 a 6 hoje). Texto, não número: o dia que entrar uma
  -- sétima forma, o atalho pode ser outra coisa.
  tecla text,
  ordem smallint NOT NULL DEFAULT 100,
  ativo boolean NOT NULL DEFAULT true,

  -- PARA ONDE O DINHEIRO VAI. É o que liga a forma ao ledger do caixa.
  --
  --   imediata    cai na conta na hora (dinheiro na gaveta, pix no banco)
  --   adquirente  passa pela maquininha e espera o prazo
  --   fiado       não entra no caixa; vira título em `contas_receber`
  liquidacao text NOT NULL DEFAULT 'imediata',

  -- Nulo em `caixa_destino_id` quer dizer "o caixa do terminal que vendeu" —
  -- é o caso do dinheiro, que entra na gaveta de quem atendeu. Apontar para um
  -- caixa fixo aqui faria toda venda em dinheiro cair no mesmo lugar.
  caixa_destino_id uuid REFERENCES caixa(id),
  adquirente_caixa_id uuid REFERENCES caixa(id),

  aceita_parcelamento boolean NOT NULL DEFAULT false,
  parcelas_max smallint NOT NULL DEFAULT 1,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT forma_pagamento_codigo_unico UNIQUE (empresa_id, codigo),

  CONSTRAINT forma_pagamento_liquidacao_check
    CHECK (liquidacao = ANY (ARRAY['imediata'::text, 'adquirente'::text, 'fiado'::text])),

  -- Forma que passa na maquininha SEM dizer qual maquininha deixaria a venda
  -- no crédito sem caixa de destino — e o lançamento morreria no ar, que é
  -- exatamente o estado de hoje: 2.123 vendas e 13 movimentos no ledger.
  CONSTRAINT forma_pagamento_adquirente_obrigatoria
    CHECK (liquidacao <> 'adquirente' OR adquirente_caixa_id IS NOT NULL),

  CONSTRAINT forma_pagamento_parcelas_coerentes
    CHECK (parcelas_max >= 1 AND (aceita_parcelamento OR parcelas_max = 1))
);

CREATE INDEX IF NOT EXISTS idx_forma_pagamento_empresa
  ON forma_pagamento (empresa_id, ordem) WHERE ativo;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. A ESCADA DE TAXAS, COM VIGÊNCIA
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS forma_pagamento_taxa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forma_id uuid NOT NULL REFERENCES forma_pagamento(id) ON DELETE CASCADE,

  -- O degrau: esta taxa vale DAQUI PARA CIMA, até o degrau seguinte. Sem
  -- `parcelas_max`, pelo motivo escrito no cabeçalho.
  parcelas_min smallint NOT NULL DEFAULT 1,
  taxa_pct numeric(6,3) NOT NULL DEFAULT 0,

  -- Nulo é "não informado", e é diferente de zero. Zero quer dizer que cai no
  -- mesmo dia — verdade para o pix e para o dinheiro, mentira para o crédito.
  -- Com zero no lugar de nulo, a conciliação cobraria hoje o que só cai em
  -- trinta dias e acusaria atraso em tudo.
  prazo_dias smallint,

  vigente_de date NOT NULL,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT forma_pagamento_taxa_degrau_unico UNIQUE (forma_id, parcelas_min, vigente_de),
  CONSTRAINT forma_pagamento_taxa_parcelas_check CHECK (parcelas_min >= 1),
  CONSTRAINT forma_pagamento_taxa_pct_check CHECK (taxa_pct >= 0 AND taxa_pct <= 100),
  CONSTRAINT forma_pagamento_taxa_prazo_check CHECK (prazo_dias IS NULL OR prazo_dias >= 0)
);

CREATE INDEX IF NOT EXISTS idx_forma_pagamento_taxa_busca
  ON forma_pagamento_taxa (forma_id, vigente_de DESC, parcelas_min DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. A CONTA BANCÁRIA, NO CAIXA QUE JÁ EXISTE
-- ─────────────────────────────────────────────────────────────────────────
--
-- `caixa` já tem os quatro tipos (pdv, tesouraria, banco, adquirente) e é o
-- que o ledger referencia. Criar uma tabela "contas" ao lado seria um segundo
-- cadastro da mesma coisa. Faltam só os dados que identificam a conta, todos
-- nuláveis: caixa de PDV não tem agência.
ALTER TABLE caixa ADD COLUMN IF NOT EXISTS instituicao text;
ALTER TABLE caixa ADD COLUMN IF NOT EXISTS agencia text;
ALTER TABLE caixa ADD COLUMN IF NOT EXISTS conta text;
ALTER TABLE caixa ADD COLUMN IF NOT EXISTS chave_pix text;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. A TAXA QUE VALE NUM DIA, PARA UM NÚMERO DE PARCELAS
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION taxa_vigente_v1(
  p_forma uuid,
  p_parcelas smallint DEFAULT 1,
  p_data date DEFAULT CURRENT_DATE
) RETURNS forma_pagamento_taxa
LANGUAGE sql STABLE AS $$
  WITH vigencia AS (
    -- A vigência que vale: a mais recente que já começou. Se NENHUMA começou
    -- — pergunta sobre data anterior ao primeiro cadastro — vale a mais
    -- antiga, em vez de devolver vazio. É a mesma escolha que `encontrarFaixa`
    -- faz no TypeScript: fora da escada, o degrau da ponta, nunca nada.
    SELECT COALESCE(
      (SELECT max(vigente_de) FROM forma_pagamento_taxa
        WHERE forma_id = p_forma AND vigente_de <= p_data),
      (SELECT min(vigente_de) FROM forma_pagamento_taxa WHERE forma_id = p_forma)
    ) AS de
  )
  SELECT t.* FROM forma_pagamento_taxa t, vigencia v
   WHERE t.forma_id = p_forma
     AND t.vigente_de = v.de
     AND t.parcelas_min <= GREATEST(p_parcelas, 1)
   ORDER BY t.parcelas_min DESC
   LIMIT 1;
$$;

COMMENT ON FUNCTION taxa_vigente_v1 IS
  'A linha de taxa que vale para esta forma, neste numero de parcelas, nesta data. Vigencia mais recente que comecou; dentro dela, o degrau de parcela mais alto que nao passa.';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. A PROJEÇÃO PARA `saude_config`, QUE É O QUE O PDV LÊ
-- ─────────────────────────────────────────────────────────────────────────
--
-- Isto é o que impede duas fontes de verdade. O cadastro é onde se edita; as
-- sete colunas antigas passam a ser CÓPIA DERIVADA, mantida pelo próprio
-- banco. Trigger e não rotina da aplicação porque cópia que depende de alguém
-- lembrar de chamar é cópia que vai divergir — e divergir aqui significa o
-- balcão calculando margem com a taxa do mês passado.

CREATE OR REPLACE FUNCTION saude_config_projeta_taxas_v1(p_empresa uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_cred_1 numeric;
  v_cred_2 numeric;
BEGIN
  -- Sem linha em `saude_config` não há o que projetar: a empresa ainda não
  -- configurou saúde da venda, e criar a linha aqui inventaria margem mínima
  -- e visibilidade de custo que ninguém escolheu.
  IF NOT EXISTS (SELECT 1 FROM saude_config WHERE empresa_id = p_empresa) THEN
    RETURN;
  END IF;

  SELECT (taxa_vigente_v1(f.id, 1::smallint)).taxa_pct INTO v_cred_1
    FROM forma_pagamento f WHERE f.empresa_id = p_empresa AND f.codigo = 'credito';
  SELECT (taxa_vigente_v1(f.id, 2::smallint)).taxa_pct INTO v_cred_2
    FROM forma_pagamento f WHERE f.empresa_id = p_empresa AND f.codigo = 'credito';

  UPDATE saude_config s SET
    taxa_pix_pct      = COALESCE((SELECT (taxa_vigente_v1(f.id)).taxa_pct FROM forma_pagamento f
                                   WHERE f.empresa_id = p_empresa AND f.codigo = 'pix'), s.taxa_pix_pct),
    taxa_dinheiro_pct = COALESCE((SELECT (taxa_vigente_v1(f.id)).taxa_pct FROM forma_pagamento f
                                   WHERE f.empresa_id = p_empresa AND f.codigo = 'dinheiro'), s.taxa_dinheiro_pct),
    taxa_debito_pct   = COALESCE((SELECT (taxa_vigente_v1(f.id)).taxa_pct FROM forma_pagamento f
                                   WHERE f.empresa_id = p_empresa AND f.codigo = 'debito'), s.taxa_debito_pct),
    taxa_carteira_pct = COALESCE((SELECT (taxa_vigente_v1(f.id)).taxa_pct FROM forma_pagamento f
                                   WHERE f.empresa_id = p_empresa AND f.codigo = 'carteira'), s.taxa_carteira_pct),
    taxa_fiado_pct    = COALESCE((SELECT (taxa_vigente_v1(f.id)).taxa_pct FROM forma_pagamento f
                                   WHERE f.empresa_id = p_empresa AND f.codigo = 'fiado'), s.taxa_fiado_pct),

    taxa_credito_vista_pct = COALESCE(v_cred_1, s.taxa_credito_vista_pct),
    -- O incremento que as duas colunas antigas comportam. `GREATEST(...,0)`
    -- porque contrato com 2x mais barato que 1x existe, e incremento negativo
    -- faria a fórmula do PDV descer a taxa a cada parcela.
    taxa_credito_parc_pct  = CASE
      WHEN v_cred_1 IS NULL OR v_cred_2 IS NULL THEN s.taxa_credito_parc_pct
      ELSE GREATEST(v_cred_2 - v_cred_1, 0)
    END,

    updated_at = now()
  WHERE s.empresa_id = p_empresa;
END;
$$;

CREATE OR REPLACE FUNCTION forma_pagamento_taxa_projeta_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_empresa uuid;
BEGIN
  SELECT empresa_id INTO v_empresa FROM forma_pagamento
   WHERE id = COALESCE(NEW.forma_id, OLD.forma_id);
  IF v_empresa IS NOT NULL THEN
    PERFORM saude_config_projeta_taxas_v1(v_empresa);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_forma_pagamento_taxa_projeta ON forma_pagamento_taxa;
CREATE TRIGGER trg_forma_pagamento_taxa_projeta
  AFTER INSERT OR UPDATE OR DELETE ON forma_pagamento_taxa
  FOR EACH ROW EXECUTE FUNCTION forma_pagamento_taxa_projeta_v1();

-- Trocar o `codigo` de uma forma muda qual coluna ela alimenta. Sem este
-- segundo trigger, renomear 'pix' deixaria `taxa_pix_pct` congelada no
-- último valor para sempre.
CREATE OR REPLACE FUNCTION forma_pagamento_projeta_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM saude_config_projeta_taxas_v1(COALESCE(NEW.empresa_id, OLD.empresa_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_forma_pagamento_projeta ON forma_pagamento;
CREATE TRIGGER trg_forma_pagamento_projeta
  AFTER INSERT OR UPDATE OF codigo, empresa_id OR DELETE ON forma_pagamento
  FOR EACH ROW EXECUTE FUNCTION forma_pagamento_projeta_v1();

-- ─────────────────────────────────────────────────────────────────────────
-- 6. ACESSO — espelhando `caixa`, que é a tabela vizinha
-- ─────────────────────────────────────────────────────────────────────────
--
-- RLS ligada, só `authenticated`, filtro por grupo de empresas. `anon` não
-- entra: o PDV não precisa, porque lê a projeção em `saude_config`.

ALTER TABLE forma_pagamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE forma_pagamento_taxa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS forma_pagamento_leitura ON forma_pagamento;
CREATE POLICY forma_pagamento_leitura ON forma_pagamento FOR SELECT TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

DROP POLICY IF EXISTS forma_pagamento_insercao ON forma_pagamento;
CREATE POLICY forma_pagamento_insercao ON forma_pagamento FOR INSERT TO authenticated
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

DROP POLICY IF EXISTS forma_pagamento_edicao ON forma_pagamento;
CREATE POLICY forma_pagamento_edicao ON forma_pagamento FOR UPDATE TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- A taxa não guarda `empresa_id` de propósito: campo repetido é campo que
-- pode mentir. A empresa vem da forma, por subconsulta.
DROP POLICY IF EXISTS forma_pagamento_taxa_leitura ON forma_pagamento_taxa;
CREATE POLICY forma_pagamento_taxa_leitura ON forma_pagamento_taxa FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM forma_pagamento f WHERE f.id = forma_id
                  AND (empresa_do_meu_grupo(f.empresa_id) OR is_system_admin())));

DROP POLICY IF EXISTS forma_pagamento_taxa_insercao ON forma_pagamento_taxa;
CREATE POLICY forma_pagamento_taxa_insercao ON forma_pagamento_taxa FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM forma_pagamento f WHERE f.id = forma_id
                       AND (empresa_do_meu_grupo(f.empresa_id) OR is_system_admin())));

DROP POLICY IF EXISTS forma_pagamento_taxa_edicao ON forma_pagamento_taxa;
CREATE POLICY forma_pagamento_taxa_edicao ON forma_pagamento_taxa FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM forma_pagamento f WHERE f.id = forma_id
                  AND (empresa_do_meu_grupo(f.empresa_id) OR is_system_admin())))
  WITH CHECK (EXISTS (SELECT 1 FROM forma_pagamento f WHERE f.id = forma_id
                       AND (empresa_do_meu_grupo(f.empresa_id) OR is_system_admin())));

-- Vigência antiga é histórico: é ela que explica por que a venda de setembro
-- foi lançada com 2,9%. Apagar só é permitido ao admin do sistema.
DROP POLICY IF EXISTS forma_pagamento_taxa_remocao ON forma_pagamento_taxa;
CREATE POLICY forma_pagamento_taxa_remocao ON forma_pagamento_taxa FOR DELETE TO authenticated
  USING (is_system_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- 7. AS FORMAS DO BAZAR EFICAZ, COMO O BALCÃO JÁ TRABALHA
-- ─────────────────────────────────────────────────────────────────────────
--
-- Códigos, nomes, ícones e teclas vêm de `src/lib/pdv/formasPagamento.ts`,
-- que é a lista que o PDV usa hoje. O destino do dinheiro vem do que o dono
-- da loja informou em 18/10/2026: uma adquirente (Mercado Pago), uma conta
-- onde cai tudo (MP Ouro), e "o pix cai na mesma hora".

INSERT INTO forma_pagamento (empresa_id, codigo, nome, icone, tecla, ordem,
                             liquidacao, caixa_destino_id, adquirente_caixa_id,
                             aceita_parcelamento, parcelas_max)
SELECT 'a1000000-0000-0000-0000-000000000001'::uuid, v.codigo, v.nome, v.icone, v.tecla, v.ordem,
       v.liquidacao,
       CASE WHEN v.destino IS NULL THEN NULL ELSE
         (SELECT id FROM caixa WHERE empresa_id = 'a1000000-0000-0000-0000-000000000001'::uuid
           AND nome = v.destino LIMIT 1) END,
       CASE WHEN v.adquirente IS NULL THEN NULL ELSE
         (SELECT id FROM caixa WHERE empresa_id = 'a1000000-0000-0000-0000-000000000001'::uuid
           AND nome = v.adquirente AND tipo = 'adquirente' LIMIT 1) END,
       v.parcela, v.pmax
  FROM (VALUES
    -- codigo      nome        icone  tecla ordem liquidacao    destino     adquirente       parcela pmax
    ('dinheiro',  'Dinheiro',  '💵', '1', 1::smallint, 'imediata',   NULL,       NULL,            false, 1::smallint),
    ('debito',    'Débito',    '💳', '2', 2::smallint, 'adquirente', NULL,       'Mercado Pago',  false, 1::smallint),
    ('credito',   'Crédito',   '💳', '3', 3::smallint, 'adquirente', NULL,       'Mercado Pago',  true,  6::smallint),
    ('pix',       'PIX',       '📱', '4', 4::smallint, 'imediata',   'MP Ouro',  NULL,            false, 1::smallint),
    ('carteira',  'Carteira',  '👛', '5', 5::smallint, 'fiado',      NULL,       NULL,            false, 1::smallint),
    ('fiado',     'Fiado',     '📒', '6', 6::smallint, 'fiado',      NULL,       NULL,            false, 1::smallint)
  ) AS v(codigo, nome, icone, tecla, ordem, liquidacao, destino, adquirente, parcela, pmax)
 WHERE NOT EXISTS (
   SELECT 1 FROM forma_pagamento f
    WHERE f.empresa_id = 'a1000000-0000-0000-0000-000000000001'::uuid AND f.codigo = v.codigo);

-- ─────────────────────────────────────────────────────────────────────────
-- 8. A PRIMEIRA VIGÊNCIA: EXATAMENTE O QUE JÁ ESTAVA VALENDO
-- ─────────────────────────────────────────────────────────────────────────
--
-- Os valores saem de `saude_config` — não são inventados aqui. A data é a
-- `updated_at` da própria linha (02/08/2026), que é quando essas taxas
-- passaram a valer de verdade. Datar de hoje faria o sistema afirmar que
-- antes de hoje não havia taxa; datar de 2000 afirmaria uma vigência que
-- ninguém cadastrou.
--
-- A escada do crédito reproduz a fórmula que o sistema já praticava:
-- 1x = vista, e cada parcela extra soma o incremento. A diferença é que agora
-- ela está ESCRITA, degrau por degrau — e quando chegar a tabela real do
-- contrato, muda cada degrau sem fórmula nenhuma no meio.
--
-- `prazo_dias`: zero só onde é verdade comprovada (dinheiro na gaveta, e o
-- pix, que o dono confirmou que "cai na mesma hora"). Débito e crédito ficam
-- NULOS porque o prazo do contrato ainda não foi informado — e nulo é o que
-- faz a tela pedir, em vez de o sistema supor D+0 e dar atraso em tudo.

INSERT INTO forma_pagamento_taxa (forma_id, parcelas_min, taxa_pct, prazo_dias, vigente_de, observacao)
SELECT f.id, d.parcelas, d.taxa, d.prazo, date(s.updated_at),
       'Primeira vigencia: valores migrados de saude_config, vigentes desde ' || date(s.updated_at)
  FROM saude_config s
  JOIN forma_pagamento f ON f.empresa_id = s.empresa_id
  CROSS JOIN LATERAL (VALUES
    ('dinheiro', 1::smallint, s.taxa_dinheiro_pct,      0::smallint),
    ('pix',      1::smallint, s.taxa_pix_pct,           0::smallint),
    ('debito',   1::smallint, s.taxa_debito_pct,        NULL::smallint),
    ('carteira', 1::smallint, s.taxa_carteira_pct,      0::smallint),
    ('fiado',    1::smallint, s.taxa_fiado_pct,         NULL::smallint),
    ('credito',  1::smallint, s.taxa_credito_vista_pct,                              NULL::smallint),
    ('credito',  2::smallint, s.taxa_credito_vista_pct + 1 * s.taxa_credito_parc_pct, NULL::smallint),
    ('credito',  3::smallint, s.taxa_credito_vista_pct + 2 * s.taxa_credito_parc_pct, NULL::smallint),
    ('credito',  4::smallint, s.taxa_credito_vista_pct + 3 * s.taxa_credito_parc_pct, NULL::smallint),
    ('credito',  5::smallint, s.taxa_credito_vista_pct + 4 * s.taxa_credito_parc_pct, NULL::smallint),
    ('credito',  6::smallint, s.taxa_credito_vista_pct + 5 * s.taxa_credito_parc_pct, NULL::smallint)
  ) AS d(codigo, parcelas, taxa, prazo)
 WHERE f.codigo = d.codigo
   AND NOT EXISTS (
     SELECT 1 FROM forma_pagamento_taxa t
      WHERE t.forma_id = f.id AND t.parcelas_min = d.parcelas AND t.vigente_de = date(s.updated_at));

COMMENT ON TABLE forma_pagamento IS
  'As formas de pagamento da empresa. Substitui a lista fixa em src/lib/pdv/formasPagamento.ts, copiada em sete arquivos. `codigo` casa com vendas.forma_pagamento e venda_pagamento.forma — nao renomear.';
COMMENT ON TABLE forma_pagamento_taxa IS
  'Escada de taxa por numero de parcelas, com vigencia. So `vigente_de`: `vigente_ate` criaria dias sem taxa, o mesmo defeito que as faixas de saude tinham com margem_max. Vigencia nova = escada completa da forma.';
COMMENT ON COLUMN forma_pagamento_taxa.prazo_dias IS
  'Dias ate o dinheiro cair. NULO e "nao informado", diferente de zero: zero faz a conciliacao cobrar hoje o que cai em trinta dias.';
