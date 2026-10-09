-- Atualização automática do PDV controlada pelo servidor.
--
-- O electron-updater do PDV lê as Releases do GitHub e, sozinho, entregaria
-- uma Release nova a TODOS os terminais na próxima abertura — inclusive a um
-- de outra linhagem (o YOGA, em 1.10.5 com a venda V1 ligada), que levaria um
-- downgrade funcional. A partir da 1.10.8 o terminal pergunta antes de baixar:
-- só baixa uma versão até o teto liberado AQUI, terminal por terminal.
--
-- NULL = este terminal não atualiza sozinho (o padrão, e o de hoje).

ALTER TABLE pdv_terminais
  ADD COLUMN IF NOT EXISTS atualizacao_liberada_ate TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pdv_terminais_atualizacao_liberada_ate_formato'
  ) THEN
    ALTER TABLE pdv_terminais
      ADD CONSTRAINT pdv_terminais_atualizacao_liberada_ate_formato
      CHECK (atualizacao_liberada_ate IS NULL OR atualizacao_liberada_ate ~ '^[0-9]+\.[0-9]+\.[0-9]+$');
  END IF;
END $$;

COMMENT ON COLUMN pdv_terminais.atualizacao_liberada_ate IS
  'Versão máxima (x.y.z) que o PDV deste terminal pode baixar sozinho das Releases do GitHub. NULL = não atualiza sozinho.';
