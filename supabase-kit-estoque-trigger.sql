-- Estoque de kit sempre verdadeiro, venha a movimentação de onde vier.
--
-- O PROBLEMA
--
-- `produtos.estoque` de um kit é um valor GRAVADO, derivado dos componentes.
-- Quem mantinha essa derivação era `recalcularKitsQueUsam()` no TypeScript,
-- chamada à mão em cada tela que mexe em estoque — e em 27/08/2026 havia OITO
-- lugares chamando e um esquecido: `EstoqueDetalhadoModal.tsx`, o ajuste
-- manual pela tela de Produtos.
--
-- Medido antes desta migração: 196 kits com composição, 77 com o estoque
-- gravado diferente do que os componentes permitem montar. Um kit com 36 KG
-- de corrente em estoque aparecia como 0 na listagem e no PDV.
--
-- É a MESMA lição que este sistema já aprendeu três vezes — gatilho da
-- carteira, redirecionamento de cliente unificado, aviso de compra por
-- WhatsApp: regra que mora numa tela não alcança quem entra pelas outras. E
-- as outras aqui são muitas: PDV web, PDV externo (grava direto no banco),
-- ajuste manual, inventário, entrada manual, entrada por XML, devolução,
-- transferência entre depósitos, importação. A nona porta ia aparecer.
--
-- POR QUE SÓ `estoque`, E NÃO O CUSTO
--
-- `recalcularKitsQueUsam()` também regrava `preco_custo` do kit. Aqui não.
-- O gatilho BEFORE `produtos_checar_permissao` exige `editar_produtos` para
-- mudar `preco_custo` — e um gatilho que atualizasse o custo do kit rodaria
-- DENTRO da transação de quem ajustou o estoque. Operador com permissão de
-- ajustar estoque mas sem `editar_produtos` veria o ajuste inteiro ser
-- recusado, por causa de um kit que ele nem sabia que existia.
--
-- A própria função de permissão diz que `estoque` é livre de propósito:
-- "são consequência de venda, entrada e ajuste, cada um com a sua permissão".
-- O custo continua a cargo das telas, que rodam com o usuário certo.

-- ── A conta, num lugar só ────────────────────────────────────────────────

-- Espelha `calcularKit()` do TypeScript, inclusive nos cantos:
--   · componente com `controla_estoque = false` (parafuso, bucha) não limita
--     quantos kits dá para montar — fica fora do mínimo;
--   · kit cujos componentes são TODOS assim resulta 0, não infinito;
--   · componente apagado simplesmente não entra na conta.
CREATE OR REPLACE FUNCTION public.estoque_do_kit(p_kit_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    MIN(FLOOR(GREATEST(c.estoque, 0) / NULLIF(ki.quantidade, 0)))
      FILTER (WHERE COALESCE(ki.controla_estoque, true)),
    0)
  FROM kit_itens ki
  JOIN produtos c ON c.id = ki.produto_id
  WHERE ki.kit_id = p_kit_id;
$$;

-- ── O gatilho ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_kit_recalcular_estoque()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Só estoque interessa. Preço e ficha não mudam quantos kits dá para montar.
  IF NEW.estoque IS NOT DISTINCT FROM OLD.estoque THEN
    RETURN NEW;
  END IF;

  -- Kit dentro de kit é permitido, mas com fundo: sem o teto, uma composição
  -- circular cadastrada por engano derrubaria toda gravação de estoque do
  -- sistema, e não só o cadastro errado. Medido em 27/08/2026: nenhum kit é
  -- componente de outro, então o teto de 4 sobra — está aqui para o dia em
  -- que deixar de sobrar.
  IF pg_trigger_depth() > 4 THEN
    RETURN NEW;
  END IF;

  -- `IS DISTINCT FROM` na cláusula do UPDATE, e não só por elegância: sem
  -- ele, todo ajuste de componente reescreveria a linha de cada kit,
  -- disparando `trg_fila_produto` e enfileirando para o marketplace um kit
  -- cujo número não mudou.
  UPDATE produtos k
     SET estoque = estoque_do_kit(k.id)
   WHERE k.id IN (SELECT ki.kit_id FROM kit_itens ki WHERE ki.produto_id = NEW.id)
     AND k.estoque IS DISTINCT FROM estoque_do_kit(k.id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kit_recalcular_estoque ON public.produtos;

CREATE TRIGGER trg_kit_recalcular_estoque
AFTER UPDATE OF estoque ON public.produtos
FOR EACH ROW
EXECUTE FUNCTION public.trg_kit_recalcular_estoque();

-- ── Acerto do que já estava errado ───────────────────────────────────────
--
-- O gatilho só olha para frente. Os 77 kits que já estavam com o número
-- errado continuariam errados até o componente se mexer de novo.
--
-- Roda sem WHERE de empresa de propósito: o defeito não escolheu empresa, e
-- deixar metade certa seria pior que deixar tudo errado — ninguém saberia em
-- qual metade confiar.
UPDATE produtos k
   SET estoque = estoque_do_kit(k.id)
 WHERE k.tipo = 'kit'
   AND EXISTS (SELECT 1 FROM kit_itens ki WHERE ki.kit_id = k.id)
   AND k.estoque IS DISTINCT FROM estoque_do_kit(k.id);
