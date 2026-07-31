// Geração de código EAN-13 para produto sem código de barras do fabricante.
//
// Prefixo 2: a GS1 reserva a faixa que começa com 2 para "circulação
// restrita" — código de uso interno da loja, que funciona no leitor do PDV e
// na etiqueta, mas não é registrado em base nenhuma e não deve sair da
// empresa. É de propósito que NÃO usamos o prefixo 789 (o do Brasil): um
// código 789 inventado se passaria por um GTIN registrado que não é nosso,
// podendo colidir com o produto real de outra empresa.
//
// Consequência prática, para não haver surpresa: marketplace que exige GTIN
// de verdade (o campo GTIN do Mercado Livre, por exemplo) pode recusar um
// código destes. Ele resolve o uso interno — etiqueta, leitura no PDV,
// identificação do item — não substitui um código comprado da GS1.

const PREFIXO_USO_INTERNO = '2'

// Último dígito do EAN-13: soma alternando peso 1 e 3, complemento de 10.
export function digitoVerificadorEan13(doze: string): number {
  let soma = 0
  for (let i = 0; i < 12; i++) {
    soma += Number(doze[i]) * (i % 2 === 0 ? 1 : 3)
  }
  return (10 - (soma % 10)) % 10
}

export function validarEan13(codigo: string): boolean {
  const limpo = (codigo ?? '').replace(/\D/g, '')
  if (limpo.length !== 13) return false
  return digitoVerificadorEan13(limpo.slice(0, 12)) === Number(limpo[12])
}

export function gerarEanInterno(): string {
  let base = PREFIXO_USO_INTERNO
  for (let i = 0; i < 11; i++) base += Math.floor(Math.random() * 10)
  return base + digitoVerificadorEan13(base)
}

// Gera um código que ainda não existe na empresa. Colisão é improvável (11
// dígitos livres), mas conferir é barato e evita dois produtos com o mesmo
// código de barras — que na prática quebraria a leitura no PDV.
export async function gerarEanInternoUnico(sb: any, empresaId: string, tentativas = 5): Promise<string> {
  for (let i = 0; i < tentativas; i++) {
    const candidato = gerarEanInterno()
    const { data } = await sb.from('produtos').select('id').eq('empresa_id', empresaId).eq('ean', candidato).maybeSingle()
    if (!data) return candidato
  }
  // Só chega aqui se a consulta estiver falhando — devolver algo válido é
  // melhor do que travar o cadastro; o banco continua sendo a última palavra.
  return gerarEanInterno()
}
