// Padrão de anúncios da empresa: as regras que o gestor escreveu em
// Configurações → Padrão de anúncios, transformadas num bloco de prompt.
//
// Fica separado das instruções técnicas (limite de caracteres, formato do
// JSON) de propósito: aquelas são exigência da plataforma e não podem ser
// desligadas; estas são preferência da loja e o gestor manda nelas.

export type PadraoAnuncio = {
  regra_titulo?: string | null
  regra_descricao?: string | null
  tom_voz?: string | null
  evitar?: string | null
}

export async function buscarPadraoAnuncio(sb: any, empresaId: string): Promise<PadraoAnuncio | null> {
  const { data } = await sb
    .from('empresa_config_anuncio')
    .select('regra_titulo, regra_descricao, tom_voz, evitar')
    .eq('empresa_id', empresaId)
    .maybeSingle()
  return data ?? null
}

// Devolve '' quando não há nada configurado — assim o prompt segue exatamente
// como era antes pra quem nunca abriu essa tela.
export function blocoPadraoAnuncio(padrao: PadraoAnuncio | null): string {
  if (!padrao) return ''
  const partes: string[] = []
  if (padrao.regra_titulo?.trim()) partes.push(`- Título: ${padrao.regra_titulo.trim()}`)
  if (padrao.regra_descricao?.trim()) partes.push(`- Descrição: ${padrao.regra_descricao.trim()}`)
  if (padrao.tom_voz?.trim()) partes.push(`- Tom de voz: ${padrao.tom_voz.trim()}`)
  if (padrao.evitar?.trim()) partes.push(`- Nunca use: ${padrao.evitar.trim()}`)
  if (partes.length === 0) return ''

  return `
PADRÃO DE ANÚNCIOS DESTA LOJA (definido pelo gestor — siga estas regras, elas têm prioridade sobre o estilo padrão):
${partes.join('\n')}

Continue obrigado a respeitar os limites técnicos da plataforma (tamanho máximo, formato da resposta) e a nunca inventar característica que não esteja no cadastro do produto — nem o padrão da loja permite isso.
`
}
