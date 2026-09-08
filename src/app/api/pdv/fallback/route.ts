import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { autenticarTerminalPdv, respostaDeRecusa } from '@/lib/pdv/autenticarTerminal'
import { chaveIdempotenciaValida } from '@/lib/pdv/decidirIdempotencia'

// O PDV AVISANDO QUE PRECISOU DO CAMINHO ANTIGO.
//
// Sem isto, "fallback" seria uma palavra num comentário. Com isto, é uma
// linha contável — e é esse número, não a ausência de erro, que autoriza ou
// barra o corte do `anon`.
//
// `exigirFlag: false` de propósito: o terminal que caiu no legado JUSTAMENTE
// porque a flag dele está desligada precisa conseguir reportar isso. Exigir a
// flag aqui silenciaria exatamente a maioria que queremos medir.
//
// O que ele NÃO consegue reportar é o caso `sem_identidade` — um terminal sem
// credencial não tem como se identificar para contar que não se identificou.
// Esse buraco é real e não tem conserto por aqui: ele se fecha quando todo
// terminal estiver ativado, que é uma das condições do corte de qualquer
// forma. Enquanto isso, o legado desses terminais é contado onde sempre foi,
// nos edge logs por `role = anon`.

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => ({}))

  const acesso = await autenticarTerminalPdv(req, { exigirFlag: false })
  if (!acesso.ok) return respostaDeRecusa(acesso)
  const ctx = acesso.contexto

  const operacao = String(corpo?.operacao ?? '').slice(0, 60)
  const chave = String(corpo?.idempotency_key ?? '')
  const motivo = String(corpo?.motivo ?? 'nao_informado').slice(0, 120)

  if (!operacao || !chaveIdempotenciaValida(chave)) {
    return NextResponse.json({ ok: false, erro: 'Informe operação e chave.' }, { status: 400 })
  }

  const agora = new Date().toISOString()
  const sb = createAdminClient()

  // `upsert` e não `insert`: se o mesmo evento cair no legado duas vezes,
  // queremos uma linha por evento, não uma por tentativa — senão o número que
  // decide o corte fica inflado por retry.
  const { error } = await sb.from('pdv_operacoes').upsert({
    terminal_id: ctx.terminal_id,
    empresa_id: ctx.empresa_id,
    operacao,
    idempotency_key: chave,
    metodo: 'legacy_fallback',
    status: 'sucesso',
    erro: motivo,
    versao_pdv: ctx.versao_pdv,
    concluido_em: agora,
  }, { onConflict: 'terminal_id,operacao,idempotency_key' })

  if (error) {
    return NextResponse.json({ ok: false, erro: 'Falha ao registrar o fallback.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
