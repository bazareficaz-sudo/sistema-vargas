-- ============================================================
-- ENTRADA DE NOTA: RATEIO DE ENCARGOS, PROMOÇÃO E POLÍTICA DE PREÇO
--
-- Três lacunas da tela de Nova Entrada, todas aditivas — nenhuma coluna é
-- removida, nenhum comportamento existente muda sozinho.
--
--  1. `entradas.encargos` guarda a NOTA em si: quais despesas e abatimentos
--     a nota tinha, de que tipo, sobre quais itens e em que base de rateio.
--     As colunas antigas (valor_frete, valor_desconto, valor_outros)
--     CONTINUAM sendo preenchidas, com a soma por tipo, para que todo
--     relatório e toda tela que já lê `entradas` siga funcionando sem saber
--     que esta coluna existe.
--
--  2. `entrada_itens.preco_custo_nota` separa duas coisas que hoje moram no
--     mesmo campo: o preço unitário QUE ESTAVA NA NOTA e o custo real de
--     aquisição depois do rateio. `preco_custo_novo` passa a ser o segundo —
--     é ele que vai para `produtos.preco_custo`, porque é ele que serve para
--     calcular margem. O primeiro é o que fecha a conferência contra o papel
--     do fornecedor: SUM(preco_custo_nota * quantidade) = valor_produtos.
--
--  3. `empresa_config_comercial.politica_preco_custo_mudou` tira da cabeça de
--     quem lança a nota a decisão que a tela vinha tomando sozinha: o que
--     fazer com o preço de venda quando o custo muda. O DEFAULT é
--     'manter_markup', que é EXATAMENTE o comportamento de hoje — rodar este
--     arquivo não muda preço nenhum.
--
-- Idempotente: pode rodar mais de uma vez.
-- ============================================================


-- ── 1. Encargos da nota ─────────────────────────────────────────
ALTER TABLE entradas ADD COLUMN IF NOT EXISTS encargos JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Seguro e bonificação ganham coluna própria em vez de sumirem dentro de
-- "outros"/"desconto": são linhas que o contador pergunta pelo nome.
ALTER TABLE entradas ADD COLUMN IF NOT EXISTS valor_seguro      NUMERIC(12,2) DEFAULT 0;
ALTER TABLE entradas ADD COLUMN IF NOT EXISTS valor_bonificacao NUMERIC(12,2) DEFAULT 0;

COMMENT ON COLUMN entradas.encargos IS
  'Lista de encargos da nota: [{id,tipo,descricao,valor,base,itens}]. tipo ∈ frete|seguro|despesas|outros|desconto|bonificacao; base ∈ valor|quantidade; itens = índices dos itens que recebem o rateio ([] = todos).';


-- ── 2. Custo da nota × custo de aquisição ───────────────────────
--
-- NUMERIC(12,4) e não (10,2): o rateio dividido pela quantidade quase nunca
-- cai em centavo redondo, e guardar já arredondado faria a conferência da
-- nota fechar errado por alguns centavos em toda entrada com frete.
ALTER TABLE entrada_itens ADD COLUMN IF NOT EXISTS preco_custo_nota  NUMERIC(12,4);
ALTER TABLE entrada_itens ADD COLUMN IF NOT EXISTS rateio_unitario   NUMERIC(12,4) DEFAULT 0;
ALTER TABLE entrada_itens ADD COLUMN IF NOT EXISTS preco_promocional NUMERIC(10,2);

COMMENT ON COLUMN entrada_itens.preco_custo_nota IS
  'Preço unitário como veio na nota do fornecedor, antes do rateio de encargos.';
COMMENT ON COLUMN entrada_itens.rateio_unitario IS
  'Encargos rateados para este item, por unidade. Positivo encarece, negativo abate.';
COMMENT ON COLUMN entrada_itens.preco_custo_novo IS
  'Custo de aquisição: preco_custo_nota + rateio_unitario. É este que vai para produtos.preco_custo.';

-- Entradas antigas não tinham rateio, então o preço da nota é o próprio
-- custo — preencher agora evita que a coluna nasça nula e que qualquer
-- soma futura tenha de decidir sozinha o que fazer com NULL.
UPDATE entrada_itens
   SET preco_custo_nota = preco_custo_novo,
       rateio_unitario  = 0
 WHERE preco_custo_nota IS NULL;


-- ── 3. Política de preço quando o custo muda ────────────────────
ALTER TABLE empresa_config_comercial
  ADD COLUMN IF NOT EXISTS politica_preco_custo_mudou TEXT NOT NULL DEFAULT 'manter_markup';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'empresa_config_comercial_politica_preco_chk'
  ) THEN
    ALTER TABLE empresa_config_comercial
      ADD CONSTRAINT empresa_config_comercial_politica_preco_chk
      CHECK (politica_preco_custo_mudou IN ('manter_markup', 'manter_preco', 'so_aumentar'));
  END IF;
END $$;

COMMENT ON COLUMN empresa_config_comercial.politica_preco_custo_mudou IS
  'O que a tela de Reajuste sugere quando o custo muda. manter_markup = recalcula o preço (comportamento histórico); manter_preco = recalcula o markup; so_aumentar = repassa alta, ignora queda.';

-- Toda empresa precisa da linha de config para a tela ter o que ler.
INSERT INTO empresa_config_comercial (empresa_id)
SELECT id FROM empresas
ON CONFLICT (empresa_id) DO NOTHING;
