-- ============================================================
-- URGENTE — Tirar do anônimo o que ele nunca deveria ter podido fazer
--
-- Conferido na produção agora, com a chave pública e sem login: o papel
-- `anon` tem SELECT, UPDATE e DELETE em 14 tabelas. Qualquer pessoa que
-- extraia a chave do site (é pública por natureza, vai dentro do
-- JavaScript) podia APAGAR as 504 vendas, alterar preços dos 14.423
-- produtos ou editar os 44 clientes.
--
-- POR QUE ESTE ARQUIVO É DIFERENTE DOS ANTERIORES:
--
-- As tentativas anteriores esbarraram sempre no mesmo ponto — ligar RLS
-- nestas tabelas derruba o PDV externo, que conecta sem sessão. Este
-- arquivo NÃO liga RLS. Ele tira privilégio de escrita que o terminal
-- comprovadamente não usa, mantendo intacto tudo que ele precisa para
-- vender. Fecha hoje, sem tocar no terminal.
--
-- O que o PDV externo faz (mapeado no fluxo equivalente do PDV interno):
--   lê      produtos, estoque, kits, imagens, clientes, vendedores, depósitos
--   cria    vendas, itens de venda, movimento de estoque, fiado, orçamentos
--   altera  estoque do produto (na baixa da venda)
--   apaga   NADA — caixa de loja não apaga registro
--
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. Ninguém apaga nada sem login ─────────────────────────
-- É o item mais grave e o de menor risco para corrigir: nenhum fluxo de
-- balcão apaga linha. Correção de venda errada agora é feita pela tela de
-- Vendas do painel, que exige login e registra o motivo.

REVOKE DELETE ON produtos, produto_estoque, produto_imagens, kit_itens,
                 clientes, vendas, venda_itens, usuarios_pdv, vendedores,
                 depositos, estoque_movimentacoes, contas_receber,
                 orcamentos, orcamento_itens
  FROM anon;

-- ── 2. Venda fechada não se altera sem login ────────────────
-- O terminal INSERE venda; nunca volta para editar. Sem isto, um estranho
-- poderia mudar o valor de uma venda já registrada.

REVOKE UPDATE ON vendas, venda_itens FROM anon;

-- ── 3. Extrato de estoque é append-only ─────────────────────
-- É a trilha que explica cada movimento. Editável, não serve de auditoria.

REVOKE UPDATE ON estoque_movimentacoes FROM anon;

-- ── 4. Cadastros que o terminal só lê ───────────────────────
-- Operador do PDV, vendedor e depósito são cadastrados no painel web.
-- O terminal apenas consulta.

REVOKE INSERT, UPDATE ON usuarios_pdv, vendedores, depositos FROM anon;

-- ── 5. Catálogo: pode baixar estoque, não pode criar produto ─
-- A baixa da venda faz UPDATE em produtos.estoque e produto_estoque —
-- esses ficam. Criar produto novo é operação de cadastro, do painel.

REVOKE INSERT ON produtos, produto_imagens, kit_itens FROM anon;

-- ── 6. Fechar a porta dos fundos: privilégio herdado ────────
-- REVOKE do `anon` não adianta se a permissão tiver sido concedida a PUBLIC
-- (todo mundo) em vez de ao papel. Nesse caso o anônimo continua apagando e o
-- SQL acima parece ter funcionado. Isso repete os mesmos REVOKEs em PUBLIC.
-- Não afeta o painel nem os crons: `authenticated` e `service_role` têm
-- concessão própria, que continua valendo.

REVOKE DELETE ON produtos, produto_estoque, produto_imagens, kit_itens,
                 clientes, vendas, venda_itens, usuarios_pdv, vendedores,
                 depositos, estoque_movimentacoes, contas_receber,
                 orcamentos, orcamento_itens
  FROM PUBLIC;
REVOKE UPDATE ON vendas, venda_itens, estoque_movimentacoes FROM PUBLIC;
REVOKE INSERT, UPDATE ON usuarios_pdv, vendedores, depositos FROM PUBLIC;
REVOKE INSERT ON produtos, produto_imagens, kit_itens FROM PUBLIC;

-- ── 7. Conferência — rode junto e leia o resultado ──────────
-- Não confie em "rodou sem erro". REVOKE em permissão que não existia também
-- roda sem erro. Esta consulta mostra o que o anônimo AINDA pode escrever.

SELECT table_name AS tabela,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS ainda_pode
  FROM information_schema.role_table_grants
 WHERE grantee = 'anon'
   AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
   AND table_name IN ('produtos','produto_estoque','produto_imagens','kit_itens',
                      'clientes','vendas','venda_itens','usuarios_pdv','vendedores',
                      'depositos','estoque_movimentacoes','contas_receber',
                      'orcamentos','orcamento_itens')
 GROUP BY table_name
 ORDER BY table_name;

-- RESULTADO ESPERADO — só estas linhas devem aparecer:
--
--   clientes               INSERT, UPDATE
--   contas_receber         INSERT, UPDATE
--   estoque_movimentacoes  INSERT
--   orcamento_itens        INSERT, UPDATE
--   orcamentos             INSERT, UPDATE
--   produto_estoque        INSERT, UPDATE
--   produtos               UPDATE
--   venda_itens            INSERT
--   vendas                 INSERT
--
-- Se aparecer DELETE em qualquer linha, ou UPDATE em `vendas`, o fechamento
-- NÃO pegou — me avise com o resultado colado antes de responder o
-- questionário da TikTok Shop.

-- ============================================================
-- O QUE CONTINUA LIBERADO PARA O ANÔNIMO, E POR QUÊ
--
--   SELECT em tudo .......... o terminal precisa do catálogo e do login
--   INSERT em vendas, venda_itens, estoque_movimentacoes,
--          contas_receber, orcamentos, orcamento_itens, clientes
--   UPDATE em produtos, produto_estoque .... baixa de estoque da venda
--   UPDATE em clientes, contas_receber, orcamentos ... o terminal pode
--          editar cliente, receber fiado e mexer em orçamento aberto
--
-- Ou seja: ainda dá para LER tudo sem login, inclusive os 44 clientes com
-- CPF. Isso só fecha quando o terminal autenticar de verdade — é o passo
-- seguinte, e o único que exige mudança fora deste banco.
-- ============================================================

-- ============================================================
-- BLOCO SEPARADO — RODE COM A LOJA FECHADA
--
-- O `senha_hash` dos operadores está legível sem login. Tirar a coluna do
-- alcance do anônimo é a correção certa, MAS derruba o login do terminal
-- se ele compara o hash localmente (que é como funciona hoje).
--
-- Só rode as duas linhas abaixo depois de o terminal passar a usar
-- `autenticar_operador_pdv()`, que confere a senha dentro do banco e nunca
-- devolve o hash:
--
--   REVOKE SELECT (senha_hash) ON usuarios_pdv FROM anon;
--
-- Para voltar atrás, se o caixa não logar:
--
--   GRANT SELECT (senha_hash) ON usuarios_pdv TO anon;
--
-- Teste antes em um terminal só, fora do horário de pico.
-- ============================================================

-- ============================================================
-- COMO DESFAZER TUDO deste arquivo, se algo no balcão parar:
--
--   GRANT DELETE ON produtos, produto_estoque, produto_imagens, kit_itens,
--                   clientes, vendas, venda_itens, usuarios_pdv, vendedores,
--                   depositos, estoque_movimentacoes, contas_receber,
--                   orcamentos, orcamento_itens TO anon;
--   GRANT UPDATE ON vendas, venda_itens, estoque_movimentacoes TO anon;
--   GRANT INSERT, UPDATE ON usuarios_pdv, vendedores, depositos TO anon;
--   GRANT INSERT ON produtos, produto_imagens, kit_itens TO anon;
--
-- Nenhum dado é alterado por este arquivo — ele só remove permissão.
-- ============================================================
