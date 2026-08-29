-- Margem promocional mínima — Fase 2 da Inteligência Comercial.
--
-- POR QUE UMA COLUNA NOVA, E SÓ UMA
--
-- As três margens da política comercial já tinham duas correspondências no
-- banco, e uma delas era falsa. Auditado em 29/08/2026:
--
--   MARGEM PISO  = `precificacao_regra.margem_minima`. Correspondência real:
--                  a coluna já é uma margem líquida em %, e `aplicarRegra` já
--                  a trata como piso (sobe o preço e avisa quando interveio).
--
--   MARGEM ALVO  = NÃO é `objetivo_valor`, ao contrário do que a Fase 1
--                  registrou. `objetivo_valor` só é margem quando
--                  `objetivo_tipo = 'margem_liquida'`; nos outros quatro tipos
--                  ele é markup (multiplicador), percentual sobre o custo ou
--                  reais por unidade. Uma regra de "markup 2,3×" não tem
--                  margem alvo escrita em lugar nenhum — ela é CONSEQUÊNCIA
--                  do preço que a regra produz naquela economia.
--                  Por isso a margem alvo é DERIVADA em tempo de cálculo, e
--                  não ganha coluna: gravá-la seria guardar um número que
--                  envelhece sozinho quando o custo, a comissão ou o frete
--                  mudam.
--
--   MARGEM PROMOCIONAL MÍNIMA = não existia. É esta migration.
--
-- FALLBACK QUANDO NULA
--
-- Nula NÃO vira 15% nem nenhum outro número inventado. Nula significa
-- "esta regra não tem política promocional declarada", e o classificador
-- então trata o limite promocional como sendo o próprio piso — ou seja, a
-- faixa promocional fica vazia e nada é aprovado automaticamente como
-- "desconto aceitável".
--
-- É o fallback mais seguro porque preserva o comportamento de hoje: antes
-- desta fase o sistema não tinha conceito de promoção aceitável, e uma
-- migration não pode passar a autorizar desconto que ninguém autorizou.

ALTER TABLE public.precificacao_regra
  ADD COLUMN IF NOT EXISTS margem_promocional_minima NUMERIC(6,2);

COMMENT ON COLUMN public.precificacao_regra.margem_promocional_minima IS
  'Margem líquida mínima (%) que uma promoção pode alcançar sem precisar de aprovação. '
  'NULA = sem política promocional: a faixa promocional fica vazia e o limite passa a ser a margem_minima (piso). '
  'Não confundir com margem_minima, que é o limite econômico absoluto.';

-- Coerência: promocional nunca abaixo do piso. Uma política que permitisse
-- desconto até abaixo do limite absoluto não é política, é contradição — e o
-- classificador teria de escolher qual das duas obedecer.
--
-- NOT VALID de propósito: a restrição vale para o que entrar de agora em
-- diante e não trava a migration se alguma linha antiga estiver estranha.
-- Validar depois, com `VALIDATE CONSTRAINT`, quando as linhas forem
-- conferidas.
ALTER TABLE public.precificacao_regra
  DROP CONSTRAINT IF EXISTS precificacao_regra_margem_promocional_coerente;

ALTER TABLE public.precificacao_regra
  ADD CONSTRAINT precificacao_regra_margem_promocional_coerente
  CHECK (
    margem_promocional_minima IS NULL
    OR margem_minima IS NULL
    OR margem_promocional_minima >= margem_minima
  ) NOT VALID;

-- ROLLBACK
--
--   ALTER TABLE public.precificacao_regra
--     DROP CONSTRAINT IF EXISTS precificacao_regra_margem_promocional_coerente;
--   ALTER TABLE public.precificacao_regra
--     DROP COLUMN IF EXISTS margem_promocional_minima;
--
-- Sem perda: a coluna é aditiva e nula em todas as linhas existentes. O
-- código trata a ausência como "sem política promocional", então derrubá-la
-- devolve exatamente o comportamento anterior.

-- RLS: `precificacao_regra` está com RLS DESABILITADA desde a criação
-- (supabase-precificacao-regras.sql). Esta migration NÃO altera isso — mudar
-- o regime de acesso da tabela junto com uma coluna nova misturaria duas
-- decisões independentes. A dívida continua registrada em
-- docs/seguranca-fechar-acesso-anon.md.
