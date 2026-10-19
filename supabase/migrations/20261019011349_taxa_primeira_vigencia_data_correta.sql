-- A primeira vigência estava datada de hoje, e devia ser 02/08/2026.
--
-- ── O DEFEITO ────────────────────────────────────────────────────────────
--
-- A migração 20261019011207 datava a primeira vigência com
-- `date(saude_config.updated_at)` — a data em que aquelas taxas passaram a
-- valer de verdade, que era 02/08/2026 20:40.
--
-- Só que ela própria destruiu esse dado antes de lê-lo. A ordem foi:
--
--   1. INSERT das 6 formas
--   2. o trigger de projeção dispara e faz UPDATE saude_config SET
--      updated_at = now()                     <-- a evidência morre aqui
--   3. INSERT das taxas, lendo `date(s.updated_at)` --> hoje
--
-- Resultado: 11 degraus datados de 2026-10-19, afirmando que antes de hoje a
-- loja não tinha taxa nenhuma. As taxas em si ficaram certas; a data, não.
--
-- O valor original, lido antes de aplicar:
-- `saude_config.updated_at = 2026-08-02 20:40:47.262+00`.
--
-- ── POR QUE DATA LITERAL, E NÃO OUTRA LEITURA ────────────────────────────
--
-- Derivar a data de uma coluna que um trigger mexe é a armadilha que acabou
-- de me pegar. A data em que um contrato passou a valer é um FATO, não um
-- cálculo: fato se escreve.

UPDATE forma_pagamento_taxa t
   SET vigente_de = '2026-08-02'::date,
       observacao = 'Primeira vigencia: valores migrados de saude_config, vigentes desde 2026-08-02'
 WHERE t.vigente_de = '2026-10-19'::date
   AND t.observacao LIKE 'Primeira vigencia:%'
   AND EXISTS (SELECT 1 FROM forma_pagamento f
                WHERE f.id = t.forma_id
                  AND f.empresa_id = 'a1000000-0000-0000-0000-000000000001'::uuid);

-- Em banco novo, a migração anterior roda e esta corrige em seguida. O
-- `WHERE` casa pela data de execução daquela, que ali é sempre "hoje" — por
-- isso a condição olha 2026-10-19 E o texto da observação: numa base criada
-- em outra data, nada casa e esta migração não faz nada, que é o correto,
-- porque lá a data já teria saído de uma `updated_at` não adulterada.
--
-- Isto não é bonito, e é o preço de corrigir sem reescrever migração já
-- aplicada. A lição ficou no comentário acima.
