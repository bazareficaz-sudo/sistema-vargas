-- ============================================================
-- TABELA NCM — Nomenclatura Comum do Mercosul
--
-- POR QUE ISTO EXISTE: a mesma razão da cest_tabela, aprendida do mesmo jeito.
--
-- A venda #201722 foi recusada com "Rejeição 778: Informado NCM fora do período
-- de vigência ou inexistente" no produto GUEPARCOLOR SUPER METALICO CROMADO.
-- O NCM 32100090 tinha sido preenchido pela IA. Ele NÃO EXISTE: a posição
-- 3210.00 tem os subitens .10 (Tintas), .20 (Vernizes) e .30 (Pigmentos), e
-- nenhum .90. O sufixo ".90" é o "outros" de muitas posições da nomenclatura —
-- e o modelo o aplicou onde ele não cabe.
--
-- É o erro que `cest.ts` já descrevia em 2026: "pedir para um modelo lembrar um
-- código é a forma menos confiável de obter o dado — ele acerta a maioria e
-- erra em silêncio". Valia para o CEST e vale igual para o NCM. Com a tabela no
-- banco, o modelo no máximo ESCOLHE entre códigos que existem.
--
-- DUAS COLUNAS DE DATA, E NÃO É ZELO: a rejeição 778 tem dois motivos num
-- texto só — "fora do período de vigência" OU "inexistente". São coisas
-- diferentes: um código que existiu e foi extinto por uma Resolução Gecex
-- posterior continua correto numa nota antiga e errado numa nota de hoje.
-- Guardar `data_inicio`/`data_fim` é o que permite dizer QUAL dos dois é.
--
-- FONTE OFICIAL (Portal Único Siscomex, Receita Federal):
--   https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json
--
-- A CARGA NÃO ESTÁ NESTE ARQUIVO, de propósito. São 15.156 linhas (10.515 com
-- 8 dígitos) e a tabela muda a cada Resolução Gecex — colar os dados aqui
-- criaria uma cópia que envelhece em silêncio, que é o defeito que este arquivo
-- existe para não repetir. Quem carrega é
-- `POST /api/fiscal/ncm/atualizar`, que busca da fonte oficial e faz upsert;
-- rodar de novo atualiza. A resposta diz quantos códigos entraram e qual ato
-- normativo estava vigente.
--
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS ncm_tabela (
  codigo       TEXT PRIMARY KEY,   -- 8 dígitos, sem máscara
  descricao    TEXT NOT NULL,
  data_inicio  DATE,
  data_fim     DATE,
  ato          TEXT,               -- ato normativo que instituiu
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A consulta mais comum é "este código existe e está vigente?" (chave primária,
-- já indexada). A segunda é "quais códigos começam com este prefixo?", para
-- oferecer os vizinhos válidos quando o informado não existe.
CREATE INDEX IF NOT EXISTS idx_ncm_codigo_prefixo ON ncm_tabela (codigo text_pattern_ops);

-- Mesma postura da cest_tabela: o conteúdo é público, mas o acesso é fechado
-- para o anônimo. Quem lê é o cadastro de produto e a emissão fiscal, ambos
-- autenticados; e uma tabela nova que nasce aberta reabre a superfície que
-- supabase-fechar-anon-onda1.sql está estreitando.
--
-- A política decide QUAIS linhas o papel vê; o GRANT decide se ele chega na
-- tabela. Os dois precisam ser fechados.
ALTER TABLE ncm_tabela ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ncm_tabela_leitura ON ncm_tabela;
CREATE POLICY ncm_tabela_leitura ON ncm_tabela
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON ncm_tabela FROM anon;
GRANT SELECT ON ncm_tabela TO authenticated;

-- A escrita é da rota de atualização, que roda com a chave de serviço (ignora
-- RLS). Não há política de INSERT/UPDATE para sessão de usuário, e é de
-- propósito: recarregar a nomenclatura é ato administrativo.

-- Conferência depois de rodar a carga:
--   SELECT count(*) FROM ncm_tabela;                        -- ~10.515
--   SELECT * FROM ncm_tabela WHERE codigo = '32100090';     -- deve vir VAZIO
--   SELECT codigo, descricao FROM ncm_tabela
--    WHERE codigo LIKE '3210%' ORDER BY codigo;             -- .10 .20 .30
