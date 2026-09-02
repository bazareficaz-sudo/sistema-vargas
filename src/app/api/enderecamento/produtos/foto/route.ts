import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

export const dynamic = 'force-dynamic'

// FOTO DE REFERENCIA DO PRODUTO NUM ENDERECO.
//
// O arquivo em si sobe direto do navegador para o Storage — mesmo caminho que
// as imagens de produto ja usam. Esta rota so GRAVA a URL, e existe por dois
// motivos que o cliente nao consegue garantir sozinho:
//
//   1. a linha de `produto_enderecos` precisa ser conferida contra a empresa
//      da sessao antes de ser escrita. Id vindo do navegador nunca e palavra
//      final sobre o que pode ser alterado;
//   2. a data e o autor da foto sao gravados aqui, com o relogio do servidor.
//      Foto de conferencia carrega uma afirmacao sobre o deposito — "estava
//      assim" — e a data dessa afirmacao nao pode vir do relogio de quem a
//      envia.

type Corpo = {
  produtoEnderecoId?: string
  /** URL publica devolvida pelo Storage. `null` remove a foto. */
  fotoUrl?: string | null
}

/**
 * So aceita URL do proprio Storage do projeto.
 *
 * Sem isso, um POST com `fotoUrl` apontando para fora gravaria endereco de
 * terceiro no banco: a tela do deposito passaria a carregar imagem de um
 * servidor que nao controlamos, e quem abrisse a tela entregaria o IP e o
 * horario para esse servidor.
 */
function urlDoNossoStorage(valor: unknown): string | null {
  const s = String(valor ?? '').trim()
  if (!s) return null
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!base) return null
  return s.startsWith(`${base}/storage/v1/object/public/`) ? s.slice(0, 2000) : null
}

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({})) as Corpo
  const id = String(body.produtoEnderecoId ?? '').trim()
  if (!id) return NextResponse.json({ ok: false, erro: 'Informe o vínculo produto/endereço.' }, { status: 400 })

  // Remocao e um caso legitimo e explicito: `fotoUrl: null`.
  const removendo = body.fotoUrl === null
  const url = removendo ? null : urlDoNossoStorage(body.fotoUrl)
  if (!removendo && !url) {
    return NextResponse.json({
      ok: false,
      erro: 'A foto precisa ter sido enviada para o armazenamento deste sistema.',
    }, { status: 400 })
  }

  // A LINHA PRECISA SER DESTA EMPRESA. O `eq('empresa_id')` no update nao
  // basta para dar uma resposta honesta: sem a leitura antes, apagar a foto
  // de outra empresa e "nao encontrei" produziriam o mesmo silencio.
  const { data: vinculo } = await sb
    .from('produto_enderecos')
    .select('id')
    .eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!vinculo) return NextResponse.json({ ok: false, erro: 'Vínculo não encontrado.' }, { status: 404 })

  const { error } = await sb.from('produto_enderecos').update({
    foto_url: url,
    foto_atualizada_em: url ? new Date().toISOString() : null,
    foto_por: url ? guarda.userId : null,
    updated_at: new Date().toISOString(),
  }).eq('id', id).eq('empresa_id', guarda.empresaId)

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, fotoUrl: url })
}
