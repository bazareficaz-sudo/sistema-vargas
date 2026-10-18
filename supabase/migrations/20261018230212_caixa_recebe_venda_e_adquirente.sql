-- O ledger do caixa passa a aceitar venda, cartão e adquirente.
--
-- ── O ESTADO QUE ISTO DESTRAVA ───────────────────────────────────────────
--
-- Medido em 18/10/2026: `caixa_movimento` tem 13 lançamentos, todos de
-- 22/09, todos testes das fases de sangria e suprimento. No mesmo período
-- passaram 2.123 vendas e R$ 58.954,14 pelos balcões — e o ledger do caixa
-- não sabe de nenhum centavo.
--
-- A razão estava nas próprias travas: `forma_pagamento` aceitava apenas
-- dinheiro, pix e transferência, e `natureza` não tinha 'venda'. O ledger
-- foi feito para MOVER dinheiro entre caixas, não para RECEBER venda.
--
-- ── A MAQUININHA É UM CAIXA ──────────────────────────────────────────────
--
-- A ideia que organiza o resto: a adquirente vira um caixa com saldo
-- próprio, e esse saldo é exatamente o que ela ainda deve à loja.
--
--     venda no crédito      ENTRADA  no caixa da adquirente  (bruto)
--     taxa                  SAÍDA    no mesmo caixa          (custo)
--     dinheiro cai na conta TRANSFERÊNCIA adquirente -> banco (liquidação)
--
-- Assim "o que passou na maquininha", "quanto custou", "o que caiu de
-- verdade" e "o que ainda não caiu" são todas perguntas de saldo, sem
-- conceito novo: movimento e transferência já existiam.
--
-- Pix cai na hora e NÃO passa pela adquirente: entra direto no banco, com a
-- taxa no mesmo caixa. Um movimento a menos por venda.

-- 1. A adquirente como tipo de caixa.
--
-- Separada de 'banco' de propósito: em 'banco' o dinheiro é meu e está
-- disponível; em 'adquirente' ele existe mas ainda não chegou. Juntar os dois
-- faria o saldo total mentir sobre o que dá para gastar hoje.
ALTER TABLE caixa DROP CONSTRAINT IF EXISTS caixa_tipo_check;
ALTER TABLE caixa ADD CONSTRAINT caixa_tipo_check
  CHECK (tipo = ANY (ARRAY['pdv'::text, 'tesouraria'::text, 'banco'::text, 'adquirente'::text]));

-- 2. Cartão entra; `carteira` NÃO.
--
-- Fiado já tem caminho próprio em `contas_receber`. Lançar também aqui seria
-- contar o mesmo dinheiro duas vezes — e o erro apareceria só no fechamento,
-- como sobra que ninguém explica.
--
-- Continua nulável: taxa não é forma de pagamento, e inventar uma para ela
-- seria pior que deixar vazio.
ALTER TABLE caixa_movimento DROP CONSTRAINT IF EXISTS caixa_movimento_forma_pagamento_check;
ALTER TABLE caixa_movimento ADD CONSTRAINT caixa_movimento_forma_pagamento_check
  CHECK (forma_pagamento IS NULL OR forma_pagamento = ANY
         (ARRAY['dinheiro'::text, 'pix'::text, 'transferencia'::text,
                'debito'::text, 'credito'::text]));

-- 3. As naturezas que faltavam.
--
-- 'estorno_venda' entra junto porque devolução existe: 17 nos últimos 30
-- dias. Sem ela, a primeira devolução depois da 4E não teria como ser
-- lançada, e alguém "resolveria" com um ajuste manual.
ALTER TABLE caixa_movimento DROP CONSTRAINT IF EXISTS caixa_movimento_natureza_check;
ALTER TABLE caixa_movimento ADD CONSTRAINT caixa_movimento_natureza_check
  CHECK (natureza = ANY (ARRAY[
    'aporte'::text, 'retirada_socio'::text, 'deposito_banco'::text, 'ajuste'::text,
    'sangria'::text, 'sangria_recebida'::text, 'suprimento_entregue'::text, 'suprimento'::text,
    'fundo_abertura'::text, 'diferenca_fechamento'::text,
    'venda'::text, 'taxa'::text, 'liquidacao'::text, 'estorno_venda'::text]));

-- 4. A liquidação é uma transferência, não um movimento solto.
--
-- Sai da adquirente e entra no banco, com os dois lados amarrados pelo mesmo
-- `transferencia_id` — que é como sangria e suprimento já funcionam. Dinheiro
-- que sai de um lugar tem de entrar em outro.
ALTER TABLE caixa_transferencia DROP CONSTRAINT IF EXISTS caixa_transferencia_especie_check;
ALTER TABLE caixa_transferencia ADD CONSTRAINT caixa_transferencia_especie_check
  CHECK (especie = ANY (ARRAY['sangria'::text, 'suprimento'::text, 'liquidacao'::text]));

-- 5. A TRAVA DE ORIGEM, que hoje não existe.
--
-- `caixa_movimento` não tem nenhuma restrição de unicidade: nada impede a
-- mesma venda de entrar duas vezes. Enquanto o ledger só recebia lançamento
-- manual, isso era tolerável. Quando a venda passar a lançar sozinha, com
-- retry e fila offline, deixa de ser.
--
-- Foi exatamente a ausência de uma trava assim que produziu 38 recebimentos
-- duplicados e R$ 2.175,73 em lançamentos excedentes, que até hoje estão no
-- histórico. Idempotência vem de constraint, nunca de convenção.
--
-- A CHAVE É (referência, natureza, caixa), e isso tem um limite consciente:
-- uma venda mista gera dois 'venda' em caixas diferentes, e passa. Mas DOIS
-- pagamentos da MESMA forma na mesma venda — possível só com o protocolo v2,
-- hoje desligado — seriam barrados. Quando o v2 entrar, a referência passa a
-- ser o id do pagamento em vez do id da venda.
CREATE UNIQUE INDEX IF NOT EXISTS idx_caixa_movimento_origem_unica
  ON caixa_movimento (referencia_tipo, referencia_id, natureza, caixa_id)
  WHERE referencia_id IS NOT NULL;

-- 6. Os caixas do Bazar Eficaz.
--
-- Mercado Pago aparece duas vezes, em papéis diferentes: como adquirente
-- (o que a maquininha deve) e como banco (o que já caiu na conta). São
-- saldos distintos, e a liquidação é a ponte entre eles.
--
-- `nome` é texto comum: renomear depois não exige migração.
INSERT INTO caixa (empresa_id, tipo, nome, ativo)
SELECT 'a1000000-0000-0000-0000-000000000001'::uuid, 'banco', 'MP Ouro', true
 WHERE NOT EXISTS (
   SELECT 1 FROM caixa
    WHERE empresa_id = 'a1000000-0000-0000-0000-000000000001'::uuid AND nome = 'MP Ouro');

INSERT INTO caixa (empresa_id, tipo, nome, ativo)
SELECT 'a1000000-0000-0000-0000-000000000001'::uuid, 'adquirente', 'Mercado Pago', true
 WHERE NOT EXISTS (
   SELECT 1 FROM caixa
    WHERE empresa_id = 'a1000000-0000-0000-0000-000000000001'::uuid AND nome = 'Mercado Pago');

COMMENT ON INDEX idx_caixa_movimento_origem_unica IS
  'Idempotencia do ledger: uma origem gera no maximo um movimento de cada natureza em cada caixa. Retry e reenvio batem aqui, nao na sorte.';
