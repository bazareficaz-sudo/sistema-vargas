-- FASE 1.1 — O APPEND-ONLY DO LEDGER PASSA A SER DITO DUAS VEZES.
--
-- A Fase 1 garantiu append-only com `REVOKE UPDATE, DELETE ON caixa_movimento
-- FROM authenticated`, e a policy ficou `FOR ALL`. Funciona — a auditoria
-- confirmou que hoje `authenticated` só tem SELECT e INSERT. Mas a garantia
-- inteira depende de um único REVOKE: no dia em que alguém reconceder o
-- grant para destravar outra coisa, a policy `FOR ALL` já autoriza UPDATE e
-- DELETE, e o ledger deixa de ser append-only sem que nenhuma policy mude —
-- em silêncio, num módulo de dinheiro.
--
-- Aqui as duas camadas passam a dizer a mesma coisa. Grant e policy têm de
-- ser afrouxados JUNTOS para o ledger virar editável, e é isso que torna o
-- afrouxamento visível em revisão.
--
-- COMO O POSTGRES DECIDE: com RLS ligada, operação sem policy é negada.
-- Então não existe "policy que proíbe UPDATE" — existe a AUSÊNCIA de policy
-- de UPDATE. É por isso que abaixo só há SELECT e INSERT: o que falta é a
-- proibição.
--
-- O predicado não muda: continua `empresa_do_meu_grupo() OR is_system_admin()`,
-- exatamente como a Fase 1 aplicou. Esta migration NÃO aperta nem afrouxa
-- quem enxerga o quê — só separa por operação. A trava de empresa no
-- domínio do Caixa é feita na camada de rota (`contextoCaixa`), porque
-- `empresa_do_meu_grupo` é por GRUPO e deixaria uma transferência cruzar
-- CNPJs do mesmo grupo.
--
-- MOMENTO: o ledger está vazio em produção (0 caixas, 0 movimentos). Trocar
-- policy de tabela com dado é operação de risco; sem dado, é gratuita. É o
-- momento mais barato que este módulo vai ter.
--
-- `caixa` é cadastro, não ledger: pode renomear e desativar, então mantém
-- UPDATE. Mas ganha as policies separadas pelo mesmo motivo — e DELETE
-- continua sem policy e sem grant, porque apagar um caixa orfanaria os
-- movimentos que apontam para ele (a FK é RESTRICT).

-- ── caixa_movimento: o ledger ─────────────────────────────────────────────
DROP POLICY IF EXISTS caixa_movimento_do_grupo ON caixa_movimento;

CREATE POLICY caixa_movimento_leitura ON caixa_movimento
  FOR SELECT TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

CREATE POLICY caixa_movimento_insercao ON caixa_movimento
  FOR INSERT TO authenticated
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- Sem policy de UPDATE e sem policy de DELETE: é a proibição.
-- Correção de lançamento errado continua sendo estorno — um movimento novo
-- de sinal contrário, referenciando o original por `estorno_de_id`.

-- ── caixa: o cadastro ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS caixa_do_grupo ON caixa;

CREATE POLICY caixa_leitura ON caixa
  FOR SELECT TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

CREATE POLICY caixa_insercao ON caixa
  FOR INSERT TO authenticated
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- UPDATE existe para renomear e desativar. `WITH CHECK` repete o predicado
-- de propósito: sem ele, seria possível mover um caixa para outra empresa
-- num UPDATE — a linha sairia do alcance de quem a editou.
CREATE POLICY caixa_edicao ON caixa
  FOR UPDATE TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- Sem policy de DELETE.

-- ── Os grants continuam como a Fase 1 os deixou ───────────────────────────
-- Reafirmados, não afrouxados: se um `GRANT ALL` genérico passar por estas
-- tabelas no futuro, estas linhas são o lugar onde a intenção está escrita.
REVOKE ALL ON TABLE caixa, caixa_movimento FROM anon;
REVOKE DELETE, TRUNCATE ON TABLE caixa FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE caixa_movimento FROM authenticated;
