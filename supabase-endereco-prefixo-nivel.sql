-- ============================================================
-- PREFIXO POR NÍVEL NO CÓDIGO DO ENDEREÇO
--
-- O gerador em lote produzia códigos só com número: "E-01-1-02". Para quem
-- está separando pedido, isso não diz nada — não dá para saber se o "02" é
-- uma gaveta, uma prateleira ou um pallet, e a pessoa precisa consultar o
-- sistema para entender o que já deveria estar escrito na etiqueta.
--
-- Endereço feito à mão não tinha esse problema porque o operador digitava
-- o texto ("ESTOQUE-01-01-GAVETA-34"), mas as faixas do gerador só produzem
-- números e letras.
--
-- Com prefixo por nível, o mesmo endereço vira "E-01-EST1-GAV02".
--
-- O prefixo é colado no valor exatamente como digitado: "GAV-" produz
-- "GAV-02", "GAV" produz "GAV02". Quem conhece o galpão decide o formato —
-- o sistema não impõe um.
-- ============================================================

ALTER TABLE deposito_enderecamento_config
  ADD COLUMN IF NOT EXISTS prefixos_por_nivel JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN deposito_enderecamento_config.prefixos_por_nivel IS
  'Prefixo colado antes do valor de cada nível ao montar o código. Ex: {"nivel":"GAV","estante":"EST"} gera A-01-EST1-GAV02.';

-- ── Conferência ──────────────────────────────────────────────
--   SELECT d.nome, c.niveis, c.prefixos_por_nivel, c.separador
--   FROM deposito_enderecamento_config c JOIN depositos d ON d.id = c.deposito_id;
