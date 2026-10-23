-- Loja Online: variações (cor, medida...) por "família" de produtos.
--
-- Cada variação continua sendo um produto próprio — com SKU, estoque, preço,
-- EAN e URL. A família só AGRUPA: na listagem cada produto aparece sozinho, e
-- na página de um deles o cliente vê as outras opções (Branco Neve, Dia
-- Nublado... ou 1/2", 3/4", 1"...) e clica para ir à página daquela opção.
--
-- Por que não "produto pai com variações": o PDV, o estoque, os marketplaces e
-- a nota fiscal trabalham com um SKU por item. Mexer nisso para a vitrine
-- quebraria o resto do sistema. Aqui nada do cadastro muda.
--
-- Cada produto pertence a no máximo UMA família (coluna, não tabela de
-- ligação). Idempotente.

CREATE TABLE IF NOT EXISTS loja_familias (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  loja_id     UUID NOT NULL REFERENCES loja_config(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  -- O que as opções são, no singular, como aparece na tela: "Cor", "Medida".
  tipo_opcao  TEXT NOT NULL DEFAULT 'Opção',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT loja_familias_nome_chk CHECK (btrim(nome) <> ''),
  CONSTRAINT loja_familias_tipo_chk CHECK (btrim(tipo_opcao) <> '')
);

CREATE INDEX IF NOT EXISTS idx_loja_familias_loja ON loja_familias (loja_id);

ALTER TABLE loja_produtos
  ADD COLUMN IF NOT EXISTS familia_id   UUID REFERENCES loja_familias(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS opcao_rotulo TEXT,
  ADD COLUMN IF NOT EXISTS opcao_cor    TEXT,
  ADD COLUMN IF NOT EXISTS opcao_ordem  INTEGER NOT NULL DEFAULT 0;

-- Cor da bolinha: #RGB ou #RRGGBB. Vazio = a opção aparece só como texto.
ALTER TABLE loja_produtos DROP CONSTRAINT IF EXISTS loja_produtos_opcao_cor_chk;
ALTER TABLE loja_produtos ADD CONSTRAINT loja_produtos_opcao_cor_chk
  CHECK (opcao_cor IS NULL OR opcao_cor ~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$');

-- Duas opções com o mesmo nome na mesma família confundem o cliente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_loja_produtos_familia_opcao
  ON loja_produtos (familia_id, lower(btrim(opcao_rotulo)))
  WHERE familia_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loja_produtos_familia
  ON loja_produtos (familia_id, opcao_ordem) WHERE familia_id IS NOT NULL;

COMMENT ON COLUMN loja_produtos.familia_id IS
  'Família de variações (cor, medida). NULL = produto sem variações.';
COMMENT ON COLUMN loja_produtos.opcao_rotulo IS
  'Nome da opção dentro da família: "Branco Neve", "3/4". Só vale com familia_id.';

-- Mesma política das demais tabelas da loja: nada para anon; o painel enxerga
-- o grupo da empresa; a vitrine lê pelo servidor.
ALTER TABLE loja_familias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE loja_familias FROM anon;

DROP POLICY IF EXISTS loja_familias_do_grupo ON loja_familias;
CREATE POLICY loja_familias_do_grupo ON loja_familias FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

NOTIFY pgrst, 'reload schema';

-- COMO DESFAZER
--   ALTER TABLE loja_produtos DROP COLUMN familia_id, DROP COLUMN opcao_rotulo,
--     DROP COLUMN opcao_cor, DROP COLUMN opcao_ordem;
--   DROP TABLE loja_familias;
