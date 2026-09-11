-- FASE 0.6C.6A.1 — o servidor recusa a segunda venda do mesmo orçamento.
--
-- `orcamentos.venda_id` continua sendo a AUTORIDADE da arbitragem. O que
-- entra aqui é o vínculo DERIVADO, do lado da venda: rastreabilidade e uma
-- defesa que não depende do cliente se comportar.
--
-- Sem FK para `orcamentos`: o trigger abaixo já exige existência E posse, que
-- é estritamente mais forte; e com `orcamentos.venda_id` apontando de volta,
-- uma FK nos dois sentidos amarraria as duas tabelas a uma ordem de inserção
-- para sempre. Ver "não criar circularidade de FK desnecessária".

ALTER TABLE public.vendas ADD COLUMN IF NOT EXISTS orcamento_id uuid;

COMMENT ON COLUMN public.vendas.orcamento_id IS
  'Orcamento de origem (vinculo derivado; a autoridade da arbitragem e orcamentos.venda_id). '
  'NULL em venda comum e em todas as vendas anteriores a 0.6C.6A.1 — sem backfill, por decisao.';

-- Uma venda por orçamento. Parcial: quantos NULL quiser.
CREATE UNIQUE INDEX IF NOT EXISTS vendas_orcamento_unico
  ON public.vendas (orcamento_id) WHERE orcamento_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.exigir_arbitragem_do_orcamento()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_o public.orcamentos%ROWTYPE;
BEGIN
  -- Venda comum: sai antes de tocar em qualquer coisa. É o caminho de 3.008
  -- das 3.008 vendas existentes, e ele não muda.
  IF NEW.orcamento_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_o FROM public.orcamentos WHERE id = NEW.orcamento_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Venda % declara o orcamento %, que nao existe.', NEW.id, NEW.orcamento_id
      USING ERRCODE = '23000', HINT = 'arbitragem_orcamento:inexistente';
  END IF;

  IF v_o.empresa_id IS DISTINCT FROM NEW.empresa_id THEN
    RAISE EXCEPTION
      'Venda % e orcamento % pertencem a empresas diferentes.', NEW.id, NEW.orcamento_id
      USING ERRCODE = '23000', HINT = 'arbitragem_orcamento:empresa_divergente';
  END IF;

  -- A ARBITRAGEM VEM ANTES DA VENDA.
  --
  -- Não é rigor decorativo: enquanto `venda_id` é nulo, nenhum terminal ganhou
  -- o orçamento, e deixar a venda entrar aqui é exatamente o buraco que
  -- produziu duas vendas remotas para um orçamento.
  IF v_o.venda_id IS NULL THEN
    RAISE EXCEPTION
      'Orcamento % ainda nao foi arbitrado: a venda % nao pode entrar antes da arbitragem.',
      NEW.orcamento_id, NEW.id
      USING ERRCODE = '23000', HINT = 'arbitragem_orcamento:sem_arbitragem';
  END IF;

  IF v_o.venda_id <> NEW.id THEN
    RAISE EXCEPTION
      'Orcamento % pertence a venda %; a venda % nao pode entrar.',
      NEW.orcamento_id, v_o.venda_id, NEW.id
      USING ERRCODE = '23000', HINT = 'arbitragem_orcamento:outra_venda_venceu';
  END IF;

  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.exigir_arbitragem_do_orcamento() IS
  'BEFORE INSERT/UPDATE OF orcamento_id em vendas. Recusa venda cujo orcamento nao existe, '
  'e de outra empresa, ainda nao arbitrado, ou ja pertencente a outra venda. '
  'RAISE e nao RETURN NULL: descartar em silencio e o defeito de trg_bloquear_venda_duplicada, '
  'e aqui o cliente PRECISA saber que perdeu para marcar o conflito.';

-- O NOME IMPORTA. Triggers do mesmo tipo disparam em ordem alfabética, e
-- `trg_bloquear_venda_duplicada` devolve NULL — descarta o INSERT em silêncio.
-- Se ele rodasse primeiro, uma venda perdedora que caísse na janela de 2
-- minutos seria engolida e o cliente veria "sincronizou". `b_` garante que
-- este rode antes dele (e depois de `a_trg_redirecionar_cliente`, que só
-- reescreve cliente_id e não interfere).
--
-- Este ordenamento é validado por teste automatizado em
-- tests/pdv/ordem-triggers-vendas.test.ts, que varre TODAS as migrations
-- desta pasta e falha se algum trigger BEFORE INSERT em `vendas` cuja função
-- descarte a linha em silêncio (RETURN NULL) vier alfabeticamente antes deste.
DROP TRIGGER IF EXISTS b_trg_venda_exige_arbitragem ON public.vendas;
CREATE TRIGGER b_trg_venda_exige_arbitragem
  BEFORE INSERT OR UPDATE OF orcamento_id ON public.vendas
  FOR EACH ROW EXECUTE FUNCTION public.exigir_arbitragem_do_orcamento();
