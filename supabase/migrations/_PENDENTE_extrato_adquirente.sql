-- O extrato da adquirente, guardado: de onde cada número veio.
--
-- ── O QUE ISTO DESTRAVA ──────────────────────────────────────────────────
--
-- Desde 20/10/2026 a venda lança no caixa sozinha, e o saldo da adquirente
-- diz quanto o Mercado Pago DEVE. Falta o outro lado: quanto ele PAGOU, em
-- que dia, e quanto cobrou de taxa de verdade.
--
-- Esse dado existe no relatório de Liberações, e o leitor dele já está
-- escrito e testado em `src/lib/financeiro/extratoAdquirente.ts`. Esta
-- migração é só o lugar de guardar o que foi lido.
--
-- ── NADA AQUI LANÇA NO LEDGER ────────────────────────────────────────────
--
-- Importar extrato NÃO cria movimento de caixa. É deliberado: o lançamento
-- automático da venda já existe, e se a importação também lançasse, o mesmo
-- dinheiro entraria duas vezes — uma pela venda, outra pelo extrato.
--
-- O extrato serve para CONFERIR. Quando a conferência estiver rodando com
-- dados reais e você vir o que ela acha, a gente decide se e como a
-- liquidação (adquirente -> banco) passa a ser lançada. Decidir isso antes de
-- ver um mês de dados seria chute.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. A IMPORTAÇÃO: quem trouxe, quando, de qual arquivo
-- ─────────────────────────────────────────────────────────────────────────
--
-- Sem isto, a pergunta "de onde veio este número" não tem resposta — e é a
-- primeira pergunta que se faz quando a conferência acusa diferença.

CREATE TABLE IF NOT EXISTS adquirente_importacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  caixa_id uuid NOT NULL REFERENCES caixa(id),

  -- O nome do arquivo que o Mercado Pago devolveu. É a prova de origem.
  arquivo text NOT NULL,
  periodo_de date,
  periodo_ate date,

  linhas_lidas integer NOT NULL DEFAULT 0,
  linhas_novas integer NOT NULL DEFAULT 0,
  -- Linha sem data ou sem identificador não entra. O número fica registrado
  -- porque descarte silencioso subestima o extrato — e o extrato é o lado
  -- que serve de referência.
  linhas_descartadas integer NOT NULL DEFAULT 0,

  -- O cabeçalho que chegou DE VERDADE. As colunas do relatório dependem da
  -- configuração da conta no Mercado Pago, e guardar o cabeçalho é o que
  -- permite entender, meses depois, por que uma importação antiga leu
  -- diferente.
  cabecalho_recebido text[],
  erro text,

  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT adquirente_importacao_periodo_coerente
    CHECK (periodo_de IS NULL OR periodo_ate IS NULL OR periodo_de <= periodo_ate)
);

CREATE INDEX IF NOT EXISTS idx_adquirente_importacao_empresa
  ON adquirente_importacao (empresa_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. AS LINHAS
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS adquirente_extrato (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  caixa_id uuid NOT NULL REFERENCES caixa(id),
  importacao_id uuid REFERENCES adquirente_importacao(id),

  -- A data em que o dinheiro foi LIBERADO, não a da venda. São diferentes:
  -- venda no crédito de 20/10 aparece liberada por volta de 19/11. Confundir
  -- as duas faria toda venda no crédito parecer divergência.
  data date NOT NULL,

  origem_id text NOT NULL,
  referencia_externa text,
  tipo text NOT NULL,

  bruto numeric(14,2) NOT NULL DEFAULT 0,
  -- Guardada POSITIVA. No arquivo vem negativa, porque é débito; no nosso
  -- ledger a taxa já é uma SAÍDA, e manter o sinal a contaria duas vezes.
  taxa numeric(14,2) NOT NULL DEFAULT 0,
  liquido numeric(14,2) NOT NULL DEFAULT 0,

  parcelas smallint,
  metodo text,

  -- A LINHA ORIGINAL, como veio. É a evidência: quando alguém discordar de um
  -- número, a resposta não é "o sistema calculou", é esta linha.
  linha_original text,

  -- ── A TRAVA DE IMPORTAR DUAS VEZES ──────────────────────────────────────
  --
  -- md5 da linha original normalizada, no escopo do caixa. Reimportar o mesmo
  -- arquivo produz linhas idênticas e nenhuma entra de novo.
  --
  -- É o hash e não (origem_id, tipo, data) porque o Mercado Pago emite VÁRIOS
  -- registros com o mesmo `source_id`: o pagamento, o ajuste de taxa, o
  -- estorno, o chargeback. Uma chave por `origem_id` descartaria registros
  -- legítimos — e descarte é invisível, enquanto duplicata é achável (a view
  -- abaixo acha).
  --
  -- O limite consciente: se o Mercado Pago reemitir o relatório com
  -- formatação diferente para o mesmo lançamento, o hash muda e a linha entra
  -- outra vez. Preferi esse risco ao de perder linha, porque extrato que
  -- subestima estraga a conferência em silêncio.
  linha_hash text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT adquirente_extrato_hash_unico UNIQUE (caixa_id, linha_hash),
  CONSTRAINT adquirente_extrato_taxa_positiva CHECK (taxa >= 0)
);

CREATE INDEX IF NOT EXISTS idx_adquirente_extrato_dia
  ON adquirente_extrato (caixa_id, data DESC);

-- Para casar transação por transação quando o PDV passar a mandar referência
-- para a maquininha. Parcial porque hoje a referência vem nula em tudo.
CREATE INDEX IF NOT EXISTS idx_adquirente_extrato_referencia
  ON adquirente_extrato (empresa_id, referencia_externa)
  WHERE referencia_externa IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. A DUPLICATA, SE HOUVER
-- ─────────────────────────────────────────────────────────────────────────
--
-- A trava de hash impede reimportar linha idêntica. O que ela não impede é a
-- mesma liberação chegar duas vezes com formatação diferente. Esta view
-- mostra isso: mesmo lançamento, mesmo dia, mesmo valor, duas linhas.
--
-- Existe porque a alternativa é descobrir depois, pela conferência acusando
-- sobra que ninguém explica — foi exatamente assim que os 38 recebimentos
-- duplicados de outubro apareceram.

CREATE OR REPLACE VIEW adquirente_extrato_suspeito_v1 AS
SELECT e.empresa_id,
       e.caixa_id,
       e.origem_id,
       e.tipo,
       e.data,
       e.bruto,
       count(*) AS vezes,
       array_agg(e.id) AS linhas,
       array_agg(DISTINCT e.importacao_id) AS importacoes
  FROM adquirente_extrato e
 WHERE empresa_do_meu_grupo(e.empresa_id) OR is_system_admin()
 GROUP BY e.empresa_id, e.caixa_id, e.origem_id, e.tipo, e.data, e.bruto
HAVING count(*) > 1;

ALTER VIEW adquirente_extrato_suspeito_v1 SET (security_invoker = true);

COMMENT ON VIEW adquirente_extrato_suspeito_v1 IS
  'Mesmo lancamento do extrato aparecendo mais de uma vez. A trava de hash pega reimportacao identica; isto pega a mesma liberacao chegando com formatacao diferente.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. ACESSO — espelhando `caixa`
-- ─────────────────────────────────────────────────────────────────────────
--
-- RLS ligada, só `authenticated`. `anon` não entra: o PDV não tem nada a ver
-- com extrato de adquirente.
--
-- Não há policy de UPDATE nem de DELETE, de propósito. Extrato é cópia do que
-- a adquirente informou: editar seria falsificar a referência contra a qual a
-- nossa conta é conferida. Importação errada se corrige importando de novo —
-- e a view acima mostra o que ficou duplicado.

ALTER TABLE adquirente_importacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE adquirente_extrato ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS adquirente_importacao_leitura ON adquirente_importacao;
CREATE POLICY adquirente_importacao_leitura ON adquirente_importacao
  FOR SELECT TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

DROP POLICY IF EXISTS adquirente_importacao_insercao ON adquirente_importacao;
CREATE POLICY adquirente_importacao_insercao ON adquirente_importacao
  FOR INSERT TO authenticated
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

DROP POLICY IF EXISTS adquirente_extrato_leitura ON adquirente_extrato;
CREATE POLICY adquirente_extrato_leitura ON adquirente_extrato
  FOR SELECT TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

DROP POLICY IF EXISTS adquirente_extrato_insercao ON adquirente_extrato;
CREATE POLICY adquirente_extrato_insercao ON adquirente_extrato
  FOR INSERT TO authenticated
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

COMMENT ON TABLE adquirente_extrato IS
  'Copia do relatorio de Liberacoes da adquirente, linha por linha, com a linha original guardada. NAO lanca no ledger: serve para conferir o que a venda ja lancou. Sem UPDATE e sem DELETE por policy -- extrato editado deixa de ser referencia.';
COMMENT ON COLUMN adquirente_extrato.data IS
  'Data em que o dinheiro foi LIBERADO, nao a da venda. Venda no credito de 20/10 aparece liberada por volta de 19/11.';
COMMENT ON TABLE adquirente_importacao IS
  'Uma linha por importacao: arquivo, periodo, quantas linhas entraram e o cabecalho que chegou de verdade. Responde "de onde veio este numero".';
