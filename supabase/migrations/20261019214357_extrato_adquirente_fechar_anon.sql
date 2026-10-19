-- Fecha o `anon` nas tabelas do extrato, como `caixa` já está.
--
-- A migração 20261019214303 afirma, em comentário, que "`anon` não entra".
-- A conferência logo depois mostrou `has_table_privilege('anon', ..., 'SELECT')`
-- verdadeiro: o grant para `anon` no schema público é padrão do Supabase, e
-- `ENABLE ROW LEVEL SECURITY` não o remove.
--
-- Na prática não havia vazamento — RLS ligada sem policy para `anon` não
-- devolve linha nenhuma. Mas duas coisas estavam erradas:
--
--   1. o comentário do código afirmava algo que o banco não garantia;
--   2. a tabela ficava fora do padrão da casa. `caixa`, usada de modelo,
--      tem `anon` revogado -- resultado das migrações
--      `fechar_anon_onda1_*`, `fechar_anon_onda2_escrita` e
--      `revogar_truncate_anon_produtos_vendas_clientes`.
--
-- Defesa em profundidade: a policy é a tranca, o grant é a porta. Deixar a
-- porta aberta confiando só na tranca significa que o dia em que alguém
-- acrescentar uma policy permissiva sem perceber, `anon` passa.
--
-- Isto só REMOVE acesso, em tabelas criadas minutos antes e que nenhum código
-- lê ainda. O PDV externo, que é quem usa a chave anônima, não tem nada a ver
-- com extrato de adquirente.

REVOKE ALL ON TABLE adquirente_extrato FROM anon;
REVOKE ALL ON TABLE adquirente_importacao FROM anon;
REVOKE ALL ON TABLE adquirente_extrato_suspeito_v1 FROM anon;
