import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirPermissao } from '@/lib/auth/permissoes'

// CARGA DA TABELA NCM, DA FONTE OFICIAL.
//
// A nomenclatura muda a cada Resolução Gecex. Uma cópia colada num arquivo SQL
// envelhece em silêncio — e "NCM que já valeu e não vale mais" é exatamente
// metade da rejeição 778. Por isso a carga é uma rota que se roda de novo, não
// um dump versionado.
//
// A tabela é a MESMA para todas as empresas (é lei federal), então a gravação
// usa a chave de serviço. A permissão exigida continua sendo por sessão: quem
// não administra fiscal não dispara uma carga de 10 mil linhas.

export const maxDuration = 60

const FONTE = 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json'

type LinhaOficial = {
  Codigo?: string
  Descricao?: string
  Data_Inicio?: string
  Data_Fim?: string
}

/** "31/12/9999" → "9999-12-31". Devolve null no que não for data. */
function dataBR(v: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v ?? '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

export async function POST() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_fiscal')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  let bruto: { Nomenclaturas?: LinhaOficial[]; Data_Ultima_Atualizacao_NCM?: string; Ato?: string }
  try {
    const res = await fetch(FONTE, { redirect: 'follow' })
    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        erro: `A fonte oficial respondeu ${res.status}. A tabela NÃO foi alterada — o que está no banco continua valendo.`,
      }, { status: 502 })
    }
    bruto = await res.json()
  } catch (e) {
    return NextResponse.json({
      ok: false,
      erro: `Não foi possível alcançar o Portal Único Siscomex: ${e instanceof Error ? e.message : String(e)}. A tabela NÃO foi alterada.`,
    }, { status: 502 })
  }

  const todas = bruto.Nomenclaturas ?? []
  const ato = bruto.Ato ?? null

  // Só os códigos de 8 dígitos. Os de 2, 4 e 6 são capítulos, posições e
  // subposições — servem para navegar a nomenclatura, mas não vão numa nota:
  // o que a NFC-e leva é o código completo.
  const linhas = todas
    .map(l => ({
      codigo: String(l.Codigo ?? '').replace(/\D/g, ''),
      descricao: String(l.Descricao ?? '').trim(),
      data_inicio: dataBR(l.Data_Inicio),
      data_fim: dataBR(l.Data_Fim),
      ato,
    }))
    .filter(l => l.codigo.length === 8 && l.descricao !== '')

  if (linhas.length < 5000) {
    // A tabela tem ~10.5 mil códigos de 8 dígitos. Vir muito menos que isso
    // significa que o formato da fonte mudou — e substituir a tabela boa por
    // uma resposta que não entendemos é pior que não atualizar.
    return NextResponse.json({
      ok: false,
      erro: `A fonte devolveu apenas ${linhas.length} códigos de 8 dígitos, muito abaixo do esperado (~10.500). O formato pode ter mudado. Nada foi gravado.`,
      recebidas: todas.length,
    }, { status: 502 })
  }

  // Upsert, não TRUNCATE + INSERT: se a carga falhar no meio, a tabela antiga
  // continua inteira e utilizável. Uma tabela fiscal vazia bloquearia toda
  // emissão que depende dela.
  const admin = createAdminClient()
  const LOTE = 1000
  let gravadas = 0
  for (let i = 0; i < linhas.length; i += LOTE) {
    const { error } = await admin.from('ncm_tabela')
      .upsert(linhas.slice(i, i + LOTE), { onConflict: 'codigo' })
    if (error) {
      return NextResponse.json({
        ok: false,
        erro: `Falha ao gravar a partir do código ${linhas[i].codigo}: ${error.message}`,
        gravadasAntesDaFalha: gravadas,
      }, { status: 500 })
    }
    gravadas += Math.min(LOTE, linhas.length - i)
  }

  const { count } = await admin.from('ncm_tabela').select('codigo', { count: 'exact', head: true })

  return NextResponse.json({
    ok: true,
    vigencia: bruto.Data_Ultima_Atualizacao_NCM ?? null,
    ato,
    recebidasDaFonte: todas.length,
    codigosDeOitoDigitos: linhas.length,
    gravadas,
    totalNaTabela: count ?? null,
    // O upsert não remove código extinto que saiu da fonte. Ele continua na
    // tabela com a `data_fim` que tinha — e é assim que se distingue "não
    // existe" de "existiu e foi extinto", que é a metade da rejeição 778 que
    // um simples "está na lista?" não responde.
    observacao: 'Códigos que saíram da fonte permanecem gravados com sua data_fim — é o que permite dizer "extinto" em vez de "inexistente".',
  })
}
