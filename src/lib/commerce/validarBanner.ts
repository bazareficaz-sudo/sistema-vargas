// Validação compartilhada entre criar (`POST /api/loja-admin/banners`) e
// editar (`PATCH /api/loja-admin/banners/[id]`) — mesma regra, um lugar só.

export function validarBanner(corpo: any): { erro: string } | { valores: Record<string, unknown> } {
  const texto = (v: unknown, max: number) => {
    if (v == null || v === '') return null
    if (typeof v !== 'string') return undefined
    return v.trim().slice(0, max) || null
  }
  const titulo = texto(corpo.titulo, 120)
  const subtitulo = texto(corpo.subtitulo, 200)
  const imagemUrl = texto(corpo.imagemUrl, 500)
  const imagemMobileUrl = texto(corpo.imagemMobileUrl, 500)
  const linkUrl = texto(corpo.linkUrl, 500)
  const ctaTexto = texto(corpo.ctaTexto, 40)
  if ([titulo, subtitulo, imagemUrl, imagemMobileUrl, linkUrl, ctaTexto].includes(undefined)) {
    return { erro: 'Campo de texto inválido' }
  }

  const ordem = Number.isFinite(Number(corpo.ordem)) ? Math.floor(Number(corpo.ordem)) : 0
  const ativo = !!corpo.ativo

  const data = (v: unknown) => {
    if (v == null || v === '') return null
    const d = new Date(String(v))
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
  }
  const inicioEm = data(corpo.inicioEm)
  const fimEm = data(corpo.fimEm)
  if (inicioEm === undefined || fimEm === undefined) return { erro: 'Data inválida' }
  if (inicioEm && fimEm && inicioEm > fimEm) return { erro: 'A vigência não pode terminar antes de começar' }

  return {
    valores: {
      titulo, subtitulo, imagem_url: imagemUrl, imagem_mobile_url: imagemMobileUrl,
      link_url: linkUrl, cta_texto: ctaTexto, ordem, ativo,
      inicio_em: inicioEm, fim_em: fimEm,
    },
  }
}
