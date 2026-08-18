-- ============================================================
-- TRANSFERÊNCIA DE ESTOQUE — entre depósitos e entre empresas do grupo
--
-- `transferencias_estoque` já existia, mas como um log plano — sem campo
-- de empresa de destino, sem produto de destino (necessário porque
-- produto é linha própria por empresa: transferir para outra empresa
-- move a quantidade para o PRODUTO EQUIVALENTE lá, não para "o mesmo
-- produto_id", que nem existe do outro lado). Nunca teve uma linha
-- gravada — o código que a alimentava (aba "Transferência" em
-- DetalheDepositoClient.tsx) só suportava a mesma empresa, e hoje cada
-- empresa tem exatamente um depósito ativo, então essa aba nunca teve
-- como ser usada de verdade.
-- ============================================================

ALTER TABLE transferencias_estoque
  ADD COLUMN IF NOT EXISTS empresa_destino_id UUID,
  ADD COLUMN IF NOT EXISTS produto_destino_id UUID,
  ADD COLUMN IF NOT EXISTS percentual NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS entrada_id UUID,
  ADD COLUMN IF NOT EXISTS entrada_origem TEXT;

COMMENT ON COLUMN transferencias_estoque.empresa_destino_id IS
  'Igual a empresa_id quando a transferência é entre depósitos da mesma empresa. Diferente quando é entre empresas do grupo.';
COMMENT ON COLUMN transferencias_estoque.produto_destino_id IS
  'Igual a produto_id na mesma empresa. Entre empresas, é o produto EQUIVALENTE na empresa destino, resolvido via produto_vinculos — sem vínculo cadastrado, o produto não pode ser transferido entre empresas.';
COMMENT ON COLUMN transferencias_estoque.percentual IS
  'Preenchido só quando o operador escolheu "% do estoque" em vez de quantidade exata ou "tudo" — guarda a escolha, não recalcula depois.';
COMMENT ON COLUMN transferencias_estoque.entrada_origem IS
  'manual | xml — de qual tabela veio entrada_id (entradas ou nfe_entradas). Preenchido só quando a transferência partiu do picker "a partir de uma entrada".';

CREATE INDEX IF NOT EXISTS idx_transferencias_estoque_destino
  ON transferencias_estoque (empresa_destino_id) WHERE empresa_destino_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transferencias_estoque_produto
  ON transferencias_estoque (produto_id);
CREATE INDEX IF NOT EXISTS idx_transferencias_estoque_empresa_data
  ON transferencias_estoque (empresa_id, created_at DESC);

-- ── Conferência ──────────────────────────────────────────────
--   SELECT count(*) FROM transferencias_estoque;
--   SELECT count(*) FROM transferencias_estoque WHERE empresa_destino_id != empresa_id;
