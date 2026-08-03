// Gera o SQL de carga da tabela CEST a partir da fonte pública.
//
// Rode de novo quando um convênio novo alterar os anexos:
//   node scripts/gerar-cest.mjs
// e depois execute o supabase-cest-tabela.sql gerado no SQL Editor. O arquivo
// já começa com TRUNCATE, então recarregar é seguro.
//
// A fonte oficial é o CONFAZ, mas ela publica em PDF:
//   https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18
// O TSV abaixo é uma transcrição pública do texto original de 14/12/2018.
// Se a transcrição sair do ar ou ficar velha, troque a URL por um arquivo
// local com as mesmas três colunas (CEST, NCM_LIST, DESCRIPTION).
import { writeFileSync } from 'fs'

const FONTE = 'https://raw.githubusercontent.com/pentalpha/ncm_tree/main/cest-table_2018-12-14.tsv'

const resposta = await fetch(FONTE)
if (!resposta.ok) throw new Error(`Falha ao baixar a tabela CEST: HTTP ${resposta.status}`)
const bruto = await resposta.text()
const linhas = bruto.split('\n').slice(1).filter(l => l.trim())

const desaspa = (s) => s.trim().replace(/^"|"$/g, '')
const escapa = (s) => s.replace(/'/g, "''")

const pares = []          // { cest, ncm, descricao }
const semNcm = []
let cests = 0

for (const linha of linhas) {
  const [cestBruto, ncmBruto, descBruto] = linha.split('\t')
  if (!cestBruto || !ncmBruto) continue

  const cest = desaspa(cestBruto).replace(/\D/g, '')
  if (cest.length !== 7) continue
  cests++

  const descricao = desaspa(descBruto ?? '').trim()

  // NCM_LIST vem como literal de lista Python: ['3917', '40103']
  const ncms = [...desaspa(ncmBruto).matchAll(/'(\d+)'/g)].map(m => m[1])
  if (ncms.length === 0) { semNcm.push(cest); continue }

  for (const ncm of ncms) pares.push({ cest, ncm, descricao })
}

// Conferência antes de gerar: distribuição de tamanho do NCM. Se quase tudo
// tiver 8 dígitos, a busca por prefixo é desnecessária; se houver muitos
// truncados, ela é obrigatória.
const porTamanho = {}
for (const p of pares) porTamanho[p.ncm.length] = (porTamanho[p.ncm.length] ?? 0) + 1

console.log(`CESTs lidos: ${cests}`)
console.log(`Pares (CEST × NCM): ${pares.length}`)
console.log(`CESTs sem NCM: ${semNcm.length}`)
console.log('Tamanho do NCM no convênio:')
for (const [tam, n] of Object.entries(porTamanho).sort((a, b) => a[0] - b[0])) {
  console.log(`  ${tam} dígitos: ${String(n).padStart(5)}  ${tam === '8' ? '(código completo)' : '(prefixo de família)'}`)
}

const cabecalho = `-- ============================================================
-- TABELA CEST — Convênio ICMS 142/2018
--
-- Por que isto existe: o CEST não é conhecimento que se deduza do nome do
-- produto. É uma tabela oficial que amarra código CEST a NCM. Pedir para uma
-- IA "lembrar" um código entre ~1.100 é a pior forma de obter o dado — ela
-- acerta a maioria e erra em silêncio. Com a tabela no banco, a consulta é
-- determinística: filtra pelo NCM do produto e sobram poucos candidatos.
--
-- ATENÇÃO À VIGÊNCIA: estes dados são do texto original do Convênio ICMS
-- 142/2018 (14/12/2018). Convênios posteriores alteraram anexos. Antes de
-- usar em apuração real, confira com a contabilidade e recarregue a partir
-- da fonte oficial do CONFAZ quando houver alteração.
--
-- Fonte oficial: https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18
--
-- COMO A BUSCA FUNCIONA: o convênio lista NCM em tamanhos diferentes — código
-- completo de 8 dígitos, mas também prefixos de 2 a 7 dígitos que valem para
-- a família inteira. Por isso a consulta casa por PREFIXO, e o prefixo mais
-- longo é o mais específico.
--
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS cest_tabela (
  id           BIGSERIAL PRIMARY KEY,
  cest         TEXT NOT NULL,
  ncm_prefixo  TEXT NOT NULL,
  descricao    TEXT NOT NULL,
  segmento     TEXT NOT NULL,
  UNIQUE (cest, ncm_prefixo)
);

-- A busca é sempre "que prefixos casam com este NCM?", então o índice é no
-- prefixo. text_pattern_ops serve o LIKE 'x%' que a consulta usa.
CREATE INDEX IF NOT EXISTS idx_cest_ncm_prefixo ON cest_tabela (ncm_prefixo text_pattern_ops);

-- Tabela de referência, igual para todos os clientes: leitura liberada,
-- escrita só por quem administra o sistema.
ALTER TABLE cest_tabela ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cest_tabela_leitura ON cest_tabela;
CREATE POLICY cest_tabela_leitura ON cest_tabela FOR SELECT USING (true);

-- Recarga completa: apaga e insere de novo, para o arquivo poder ser rodado
-- outra vez quando um convênio novo alterar os anexos.
TRUNCATE cest_tabela;

`

const partes = [cabecalho]
const LOTE = 500
for (let i = 0; i < pares.length; i += LOTE) {
  const lote = pares.slice(i, i + LOTE)
  partes.push('INSERT INTO cest_tabela (cest, ncm_prefixo, descricao, segmento) VALUES\n')
  partes.push(lote.map(p =>
    `('${p.cest}', '${p.ncm}', '${escapa(p.descricao)}', '${p.cest.slice(0, 2)}')`
  ).join(',\n'))
  partes.push(';\n\n')
}

partes.push(`-- Conferência: deve devolver ${pares.length} pares.
SELECT count(*) AS pares, count(DISTINCT cest) AS cests_distintos FROM cest_tabela;

-- Exemplo do que a busca faz para um produto com NCM 39259090:
SELECT cest, ncm_prefixo, descricao
FROM cest_tabela
WHERE '39259090' LIKE ncm_prefixo || '%'
ORDER BY length(ncm_prefixo) DESC;
`)

writeFileSync('supabase-cest-tabela.sql', partes.join(''), 'utf8')
console.log(`\nGerado supabase-cest-tabela.sql`)
