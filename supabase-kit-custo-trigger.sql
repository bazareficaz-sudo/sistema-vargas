-- Custo de kit sempre acompanhando os componentes, e estoque também quando a
-- COMPOSIÇÃO muda — venha a alteração de onde vier.
--
-- Complementa supabase-kit-estoque-trigger.sql, que cobre só o estoque do
-- componente. Medido em 05/10/2026 (Bazar Eficaz, 256 kits com composição):
-- 58 com custo diferente do que os componentes somam e 13 com estoque
-- gravado errado. O custo não tinha NENHUMA proteção no banco: dependia de
-- cada tela chamar recalcularKitsQueUsam(), e três lugares que gravam custo
-- de componente não chamavam (ou chamavam antes de gravar).
--
-- POR QUE O CUSTO AGORA PODE FICAR NO BANCO
--
-- O arquivo do gatilho de estoque deixou o custo de fora de propósito: o
-- gatilho `produtos_checar_permissao` exige `editar_produtos` para mudar
-- `preco_custo`, e um gatilho de ESTOQUE que mexesse no custo abortaria o
-- ajuste de quem só tem permissão de estoque. O gatilho daqui é diferente:
-- dispara quando o CUSTO DE UM COMPONENTE muda, e quem muda custo já precisa
-- de `editar_produtos` (senão a própria mudança é recusada antes) — ou é
-- servidor, sem usuário. Mesmo assim, a gravação do custo do kit fica num
-- bloco que engole "sem permissão": no pior caso o custo espera a próxima
-- edição, e NUNCA derruba a operação de quem chamou.
--
-- A REGRA DE CONFIANÇA (igual à de calcularKit() no TypeScript)
--
-- custo_do_kit() devolve NULO — e então nada é gravado — quando a soma não
-- representa o custo do kit:
--   · componente sem custo (a soma sairia parcial ou zero);
--   · componente apagado;
--   · quantidade na composição abaixo de 0,01 (cadastro errado: um kit de
--     "150 buchas" com 0,0002 de cada).
-- Nesses casos o custo já gravado — que alguém pode ter digitado da nota —
-- vale mais que a conta.
--
-- LIMITE CONHECIDO: produtos.preco_custo tem 2 casas decimais. Kit de pacote
-- de peça barata (100 buchas a R$ 0,04 cada) perde precisão na soma; o custo
-- do pacote vem da nota do fornecedor, não da conta. O gatilho recalcula esses
-- kits quando o custo de um componente muda — se o pacote tem custo próprio da
-- compra, vale conferir depois (ver supabase-kit-recalcular-existentes.sql).
--
-- Execute no Supabase Dashboard → SQL Editor

-- ── A conta do custo, num lugar só ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.custo_do_kit(p_kit_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN COUNT(*) = 0 THEN NULL
    WHEN COUNT(*) FILTER (
      WHERE c.id IS NULL OR COALESCE(c.preco_custo, 0) <= 0 OR ki.quantidade < 0.01
    ) > 0 THEN NULL
    ELSE ROUND(SUM(c.preco_custo * ki.quantidade), 2)
  END
  FROM kit_itens ki
  LEFT JOIN produtos c ON c.id = ki.produto_id
  WHERE ki.kit_id = p_kit_id;
$$;

-- ── Recalcula UM kit: estoque e custo, cada um na sua gravação ───────────

CREATE OR REPLACE FUNCTION public.recalcular_kit(p_kit_id UUID)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_custo NUMERIC;
BEGIN
  -- Estoque primeiro e sozinho: é livre de permissão, e é o que mais
  -- importa na hora de vender.
  UPDATE produtos
     SET estoque = estoque_do_kit(id)
   WHERE id = p_kit_id
     AND estoque IS DISTINCT FROM estoque_do_kit(id);

  v_custo := custo_do_kit(p_kit_id);
  IF v_custo IS NOT NULL THEN
    BEGIN
      UPDATE produtos
         SET preco_custo = v_custo
       WHERE id = p_kit_id
         AND preco_custo IS DISTINCT FROM v_custo;
    EXCEPTION WHEN insufficient_privilege THEN
      -- Sem `editar_produtos`: o custo espera quem tem. O estoque, acima, já foi.
      NULL;
    END;
  END IF;
END;
$$;

-- ── Gatilho 1: o custo de um COMPONENTE mudou ────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_kit_recalcular_custo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
BEGIN
  IF NEW.preco_custo IS NOT DISTINCT FROM OLD.preco_custo THEN
    RETURN NEW;
  END IF;

  -- Mesmo teto do gatilho de estoque: composição circular cadastrada por
  -- engano não pode derrubar toda gravação de custo do sistema.
  IF pg_trigger_depth() > 4 THEN
    RETURN NEW;
  END IF;

  FOR r IN SELECT DISTINCT ki.kit_id FROM kit_itens ki WHERE ki.produto_id = NEW.id LOOP
    PERFORM recalcular_kit(r.kit_id);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kit_recalcular_custo ON public.produtos;

CREATE TRIGGER trg_kit_recalcular_custo
AFTER UPDATE OF preco_custo ON public.produtos
FOR EACH ROW
EXECUTE FUNCTION public.trg_kit_recalcular_custo();

-- ── Gatilho 2: a COMPOSIÇÃO do kit mudou ─────────────────────────────────
--
-- O gatilho de estoque só olha o estoque do componente. Adicionar, tirar ou
-- trocar a quantidade de um componente muda quantos kits dá para montar e
-- quanto o kit custa, e só a tela de edição cuidava disso.

CREATE OR REPLACE FUNCTION public.trg_kit_itens_recalcular()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalcular_kit(OLD.kit_id);
  ELSE
    PERFORM recalcular_kit(NEW.kit_id);
    IF TG_OP = 'UPDATE' AND OLD.kit_id IS DISTINCT FROM NEW.kit_id THEN
      PERFORM recalcular_kit(OLD.kit_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_kit_itens_recalcular ON public.kit_itens;

CREATE TRIGGER trg_kit_itens_recalcular
AFTER INSERT OR UPDATE OR DELETE ON public.kit_itens
FOR EACH ROW
EXECUTE FUNCTION public.trg_kit_itens_recalcular();
