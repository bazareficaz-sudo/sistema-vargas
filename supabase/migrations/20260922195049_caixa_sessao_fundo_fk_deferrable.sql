-- FASE 3 — CORREÇÃO: A REFERÊNCIA MÚTUA PRECISA SER ADIADA ATÉ O COMMIT.
--
-- `caixa_sessao.fundo_transferencia_id` aponta para a transferência que
-- trouxe o fundo, e `caixa_transferencia.sessao_id` aponta de volta para a
-- sessão. Com o fundo vindo da tesouraria, as duas linhas nascem na mesma
-- transação e cada uma precisa da outra — não existe ordem de inserção que
-- satisfaça as duas FKs no momento de cada INSERT.
--
-- Encontrado pelos testes de banco antes de qualquer uso real.
--
-- A saída natural seria inserir a transferência primeiro e completar a
-- sessão depois, mas `caixa_transferencia` é append-only: `authenticated`
-- não tem UPDATE, e as RPCs são SECURITY INVOKER. Preencher depois exigiria
-- afrouxar o append-only do ledger — trocar uma garantia de dinheiro por
-- conveniência de ordem de INSERT.
--
-- DEFERRABLE INITIALLY DEFERRED resolve sem afrouxar nada: as duas linhas
-- existem ao fim da transação, e é aí que o Postgres confere. Se a
-- transação abortar, nenhuma das duas fica.
ALTER TABLE caixa_sessao DROP CONSTRAINT IF EXISTS caixa_sessao_fundo_transferencia_id_fkey;
ALTER TABLE caixa_sessao ADD CONSTRAINT caixa_sessao_fundo_transferencia_id_fkey
  FOREIGN KEY (fundo_transferencia_id) REFERENCES caixa_transferencia(id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
