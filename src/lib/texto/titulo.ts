// Formata um nome de produto vindo do cadastro (quase sempre em CAIXA ALTA,
// como "BOCAL FLEXIVEL C/BOTAO") pro formato usado em anúncio de marketplace:
// primeira letra de cada palavra maiúscula, resto minúsculo.
//
// O que NÃO é convertido, de propósito:
//  - conectivos no meio do título (de, da, com, para...) ficam minúsculos,
//    que é a convenção de título em português;
//  - siglas e códigos de modelo (WJ2304, LED, PVC, 220V) continuam como
//    estão — baixar a caixa deles deixaria o anúncio pior, não melhor.

const CONECTIVOS = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'para', 'por', 'e', 'ou', 'em', 'no', 'na', 'nos', 'nas', 'a', 'o', 'ao'])

// Siglas mantidas em caixa alta. É uma lista explícita de propósito: a regra
// genérica "3 letras maiúsculas = sigla" transformava palavras comuns em
// sigla ("TORNEIRA PARA PIA" virava "para PIA").
const SIGLAS = new Set([
  'LED', 'PVC', 'ABS', 'PP', 'PE', 'PU', 'EVA', 'MDF', 'INOX', 'USB', 'LCD', 'TV', 'DVD',
  'PET', 'CPU', 'RGB', 'GPS', 'GNV', 'SMD', 'CFTV', 'PPR', 'CPVC', 'AC', 'DC',
])

// Trata como código/sigla (mantém intacto) o que tem dígito misturado com
// letra (WJ2304, 220V, 103N) ou está na lista de siglas acima.
function ehCodigoOuSigla(palavra: string): boolean {
  const temLetra = /[a-zA-Z]/.test(palavra)
  const temDigito = /\d/.test(palavra)
  if (temLetra && temDigito) return true
  return SIGLAS.has(palavra.toUpperCase())
}

function formatarPalavra(palavra: string, primeira: boolean): string {
  if (!palavra) return palavra
  if (ehCodigoOuSigla(palavra)) return palavra

  // Palavra composta por barra ou hífen ("C/BOTAO", "ANTI-CHAMA") — formata
  // cada parte, senão só a primeira letra do bloco inteiro subiria.
  if (/[/-]/.test(palavra)) {
    return palavra
      .split(/([/-])/)
      .map((parte, i) => (parte === '/' || parte === '-' ? parte : formatarPalavra(parte, primeira && i === 0)))
      .join('')
  }

  const minuscula = palavra.toLowerCase()
  if (!primeira && CONECTIVOS.has(minuscula)) return minuscula
  return minuscula.charAt(0).toUpperCase() + minuscula.slice(1)
}

export function formatarTituloAnuncio(nome: string): string {
  const limpo = (nome ?? '').trim().replace(/\s+/g, ' ')
  if (!limpo) return ''
  return limpo.split(' ').map((p, i) => formatarPalavra(p, i === 0)).join(' ')
}
