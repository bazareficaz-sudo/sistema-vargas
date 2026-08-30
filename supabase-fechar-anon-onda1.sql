-- ============================================================
-- FECHAR O ACESSO ANÔNIMO — ONDA 1
--
-- Primeira execução do plano de `docs/seguranca-fechar-acesso-anon.md`, e a
-- primeira que age em cima de MEDIÇÃO em vez de dedução — que é o passo 1 do
-- plano e o que travou as tentativas anteriores.
--
-- ── O que a medição mostrou (30/08/2026, 24h de logs do edge) ──
--
-- A superfície anônima real é PEQUENA: 887 requisições, 8 IPs, 21 caminhos.
-- O terminal do balcão (user-agent `node`) lê em ciclo 14 tabelas, escreve em
-- 5, e o app (`Dart/3.12`) lê `vendas` e `venda_itens`.
--
-- Nada aqui toca nessas tabelas. Esta onda mexe SÓ no que teve ZERO leitura
-- anônima na janela medida.
--
-- ── Duas correções ao plano registrado ──────────────────────
--
-- 1. O passo 3 do plano ("tirar coluna, não tabela" em `produtos` e
--    `clientes`) NÃO PODE ser executado como está escrito. O terminal pede
--    `select=*` nessas tabelas, e o PostgREST recusa o `select=*` inteiro com
--    403 quando uma coluna é revogada — não devolve o resultado sem ela.
--    Medido nos logs, não deduzido. Aquele passo derrubaria o caixa.
--
-- 2. O plano diz que a escrita anônima "já foi podada". Não foi. `anon` tem
--    INSERT/UPDATE/DELETE em dezenas de tabelas com RLS desligada — e em uma
--    delas isso é escalada de privilégio (§1 abaixo).
--
-- ── Regra de execução, do próprio plano ─────────────────────
--
-- Fora do expediente, um passo por vez, com o bloco COMO DESFAZER à mão.
-- Cada seção abaixo é independente: dá para reverter uma sem tocar nas outras.
--
-- Execute no Supabase Dashboard → SQL Editor.
-- ============================================================


-- ============================================================
-- 1. system_admins — a escalada de privilégio
--
-- O item mais grave do banco hoje, e ele não está no documento do plano.
--
-- A tabela tem RLS DESLIGADA. As três políticas dela existem e não valem
-- nada — política sem RLS é decoração. E `anon` tem INSERT.
--
-- A função que governa o acesso de plataforma inteira é:
--
--     select exists(select 1 from system_admins
--                    where id = auth.uid() and ativo = true)
--
-- e ela aparece como `... OR is_system_admin()` nas políticas de RLS de todo
-- o sistema, incluindo as da Loja Online. Ou seja: quem inserisse a própria
-- conta aqui passaria a enxergar todos os tenants.
--
-- Com RLS desligada, o GRANT é o único portão. Tirá-lo fecha o caminho
-- inteiro, e sem risco: a tabela teve ZERO tráfego anônimo, o painel usa
-- sessão autenticada e o servidor usa chave de serviço (que ignora RLS).
--
-- POR QUE NÃO LIGAR RLS AQUI: a política `system_admins_superadmin_write` faz
-- `EXISTS (SELECT 1 FROM system_admins ...)` dentro da política da PRÓPRIA
-- tabela. Ligar RLS com ela assim dispara "infinite recursion detected in
-- policy for relation system_admins" e quebra o superadmin. Reescrever a
-- política para usar uma função SECURITY DEFINER é passo próprio, com teste.
-- ============================================================

REVOKE ALL ON system_admins FROM anon;


-- ============================================================
-- 2. usuarios_pdv — o `senha_hash` dos operadores
--
-- É o passo 2 do plano, e ele estava condicionado a "o terminal passar a usar
-- `autenticar_operador_pdv()`". Os logs mostram que ELE JÁ USA — a chamada
-- aparece em `/rest/v1/rpc/autenticar_operador_pdv` — e `usuarios_pdv` não
-- aparece uma única vez nas leituras anônimas de 24h.
--
-- A forma importa. `REVOKE SELECT (senha_hash)` sozinho NÃO funciona quando o
-- privilégio foi concedido no nível da tabela: o Postgres não subtrai coluna
-- de um grant de tabela. O caminho é derrubar o grant de tabela e reconceder
-- coluna a coluna, sem o hash.
--
-- RESSALVA HONESTA: se algum dia o terminal fizer `select=*` nesta tabela,
-- isto o quebra — pelo mesmo motivo do §2 do cabeçalho. Hoje ele não faz, e
-- não fez nenhuma leitura. O desfazer está no fim do arquivo e é uma linha.
-- ============================================================

REVOKE SELECT ON usuarios_pdv FROM anon;

GRANT SELECT (
  id, empresa_id, empresa_nome, empresa_fiscal_id, empresa_fiscal_nome,
  empresa_estoque_id, empresa_estoque_nome, deposito_id, deposito_nome,
  login, nome, cargo, unificar_estoque, permissoes, ativo,
  created_at, updated_at, limite_desconto
) ON usuarios_pdv TO anon;


-- ============================================================
-- 3. Tabelas sensíveis com ZERO tráfego anônimo
--
-- Nenhuma delas apareceu nas 887 requisições anônimas de 24h. Todas contêm
-- dado que não tem por que sair sem login:
--
--   whatsapp_mensagens  → conteúdo e telefone de cliente (880 linhas)
--   fornecedor_produto  → custo por fornecedor
--   produto_vinculos    → o mapa de produtos entre empresas do grupo
--   cr_auditoria        → auditoria de contas a receber
--   vendedor_auditoria  → auditoria de vendedores
--   cobranca_historico  → histórico de cobrança
--
-- `REVOKE ALL` e não só SELECT: em todas elas o anônimo tinha também
-- INSERT/UPDATE/DELETE, e nenhuma foi escrita por ele.
-- ============================================================

REVOKE ALL ON whatsapp_mensagens FROM anon;
REVOKE ALL ON fornecedor_produto FROM anon;
REVOKE ALL ON produto_vinculos   FROM anon;
REVOKE ALL ON cr_auditoria       FROM anon;
REVOKE ALL ON vendedor_auditoria FROM anon;
REVOKE ALL ON cobranca_historico FROM anon;


-- ============================================================
-- 4. estoque_movimentacoes — o terminal escreve, nunca lê
--
-- Só o SELECT sai; o INSERT fica, porque é por ele que a baixa de estoque do
-- balcão é registrada.
--
-- Conferido antes de escrever esta linha, e é o detalhe que decidia: o POST
-- do terminal vai SEM o cabeçalho `Prefer: return=representation`. Com ele,
-- o PostgREST devolveria a linha inserida e exigiria SELECT — e tirar o
-- SELECT quebraria a gravação da venda. Sem ele, não exige.
--
-- (Repare no contraste: `produtos`, `produto_estoque` e `vendas` recebem
-- PATCH/POST COM `return=representation`. Nessas, SELECT e escrita andam
-- juntos e não dá para separar. Por isso elas não estão nesta onda.)
-- ============================================================

REVOKE SELECT ON estoque_movimentacoes FROM anon;


-- ============================================================
-- CONFERÊNCIA — rode logo depois, e antes de sair
--
--   SELECT c.relname,
--          has_table_privilege('anon', c.oid, 'SELECT') AS le,
--          has_table_privilege('anon', c.oid, 'INSERT') AS insere
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname='public'
--      AND c.relname IN ('system_admins','usuarios_pdv','whatsapp_mensagens',
--                        'fornecedor_produto','produto_vinculos','cr_auditoria',
--                        'vendedor_auditoria','cobranca_historico',
--                        'estoque_movimentacoes');
--
--   -- esperado: tudo false, EXCETO
--   --   usuarios_pdv          le = true  (colunas, sem senha_hash)
--   --   estoque_movimentacoes insere = true
--
--   -- o hash tem de estar fora do alcance:
--   SELECT has_column_privilege('anon','usuarios_pdv','senha_hash','SELECT');
--   -- esperado: false
--
-- E o teste que vale mais que todos: FAZER UMA VENDA no terminal.
-- ============================================================


-- ============================================================
-- COMO DESFAZER — por seção, se algo no balcão parar
--
--   -- §1
--   GRANT SELECT, INSERT, UPDATE, DELETE ON system_admins TO anon;
--
--   -- §2  (a linha que devolve o login do terminal ao que era)
--   GRANT SELECT ON usuarios_pdv TO anon;
--
--   -- §3
--   GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_mensagens, fornecedor_produto,
--         produto_vinculos, cr_auditoria, vendedor_auditoria, cobranca_historico TO anon;
--
--   -- §4
--   GRANT SELECT ON estoque_movimentacoes TO anon;
--
-- Nenhuma linha de dado é alterada por este arquivo. Ele só mexe em
-- privilégio, e privilégio volta com um GRANT.
-- ============================================================
