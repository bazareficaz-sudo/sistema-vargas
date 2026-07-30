// Abertura/impressão da DANFE da NFC-e no navegador.
//
// Duas armadilhas que este módulo existe pra resolver:
//
// 1. O que a Brasil NFe devolve em Base64File é HTML, não PDF — mesmo com o
//    campo se chamando "File" e a gente ter guardado como
//    "data:application/pdf;base64,...". Confirmado com a DANFE real de uma
//    NFC-e autorizada (o conteúdo decodificado começa com "<html>").
//    Então o tipo é detectado pelo conteúdo, não pelo rótulo.
//
// 2. Navegador não abre `data:` URL em aba nova (o Chrome bloqueia navegação
//    de topo pra data:). O link "Ver DANFE" que existia simplesmente não
//    funcionava. Aqui o conteúdo é reescrito numa janela nova (HTML) ou
//    convertido em blob: URL (PDF), que abrem normalmente.

export type ResultadoDanfe = { ok: true } | { ok: false; erro: string }

// Mesma preferência de papel do comprovante (Configurações → Impressão).
// A DANFE vem pronta da Brasil NFe, então não dá pra remontar o layout —
// mas dá pra dizer ao navegador em que papel imprimir, que é o que faz a
// bobina sair no tamanho certo em vez de espremida numa folha A4.
export type FormatoPapel = 'a4' | 'bobina_80' | 'bobina_58'

function cssDaPagina(formato: FormatoPapel): string {
  if (formato === 'a4') return '@page { size: A4; margin: 10mm; }'
  const largura = formato === 'bobina_80' ? '80mm' : '58mm'
  return `
    @page { size: ${largura} auto; margin: 2mm; }
    html, body { width: ${largura}; margin: 0; padding: 0; }
    body * { max-width: 100%; }
  `
}

function decodificarBase64(base64: string): string {
  const binario = atob(base64)
  // A DANFE tem acento (razão social, endereço); decodifica como UTF-8 em vez
  // de latin1, senão sai "RAZÃO" virando "RAZÃƒO".
  const bytes = Uint8Array.from(binario, c => c.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

function base64ParaBlob(base64: string, mime: string): Blob {
  const binario = atob(base64)
  const bytes = Uint8Array.from(binario, c => c.charCodeAt(0))
  return new Blob([bytes], { type: mime })
}

// `imprimir: true` já dispara o diálogo de impressão (caso "imprimir a NFC-e").
// Com `false`, só abre pra visualizar.
export function abrirDanfe(
  url: string | null | undefined,
  opcoes: { imprimir?: boolean; formato?: FormatoPapel } = {}
): ResultadoDanfe {
  if (!url) return { ok: false, erro: 'Esta venda não tem DANFE guardada.' }

  // URL normal (é o formato de outros provedores, ex: Focus NFe) — abre direto.
  if (!url.startsWith('data:')) {
    const janela = window.open(url, '_blank')
    if (!janela) return { ok: false, erro: 'O navegador bloqueou a janela. Permita pop-ups para este site.' }
    return { ok: true }
  }

  const base64 = url.slice(url.indexOf(',') + 1)
  if (!base64) return { ok: false, erro: 'DANFE guardada em formato inválido.' }

  let conteudo: string
  try {
    conteudo = decodificarBase64(base64)
  } catch {
    return { ok: false, erro: 'Não foi possível ler a DANFE guardada.' }
  }

  const ehHtml = /^\s*<(!doctype|html)/i.test(conteudo)
  const ehPdf = conteudo.startsWith('%PDF')

  if (ehPdf) {
    const blobUrl = URL.createObjectURL(base64ParaBlob(base64, 'application/pdf'))
    const janela = window.open(blobUrl, '_blank')
    if (!janela) {
      URL.revokeObjectURL(blobUrl)
      return { ok: false, erro: 'O navegador bloqueou a janela. Permita pop-ups para este site.' }
    }
    // O visualizador de PDF tem impressão própria; não forçamos o diálogo.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
    return { ok: true }
  }

  if (!ehHtml) return { ok: false, erro: 'A DANFE guardada não está em HTML nem em PDF.' }

  const janela = window.open('', '_blank')
  if (!janela) return { ok: false, erro: 'O navegador bloqueou a janela. Permita pop-ups para este site.' }
  janela.document.open()
  janela.document.write(conteudo)
  // Vai depois do conteúdo pra ganhar do CSS que a própria DANFE traz.
  janela.document.write(`<style>${cssDaPagina(opcoes.formato ?? 'a4')}</style>`)
  janela.document.close()

  if (opcoes.imprimir) {
    // Espera o layout/imagens (a DANFE tem QR-Code) antes de imprimir, senão
    // sai página em branco ou sem o código. Escrevendo o documento direto
    // assim, o onload pode nunca disparar — daí o timeout como rede de
    // segurança, com guarda pra não abrir o diálogo duas vezes.
    let jaImprimiu = false
    const imprimirUmaVez = () => {
      if (jaImprimiu) return
      jaImprimiu = true
      try { janela.print() } catch { /* janela fechada pelo usuário */ }
    }
    janela.onload = imprimirUmaVez
    setTimeout(imprimirUmaVez, 700)
  }
  return { ok: true }
}
