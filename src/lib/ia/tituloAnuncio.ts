// Bloco de prompt compartilhado pela geração de título de anúncio (Shopee e
// Mercado Livre). Fica aqui, e não duplicado nas duas rotas, porque a regra é
// do negócio — quando o padrão de título mudar, muda num lugar só.
//
// O nome vem do cadastro interno abreviado, sem acento e em CAIXA ALTA
// ("BOCAL FLEXIVEL C/BOTAO"). O título do anúncio precisa do oposto disso:
// escrito por extenso, acentuado, e com um complemento que diferencie o
// anúncio dos concorrentes.

export function instrucaoTitulos(maxCaracteres: number): string {
  return `Gere 3 opções de título pro anúncio, diferentes entre si, seguindo estas regras:

- Escreva em português correto e ACENTUADO. O nome vem do cadastro interno sem acento — corrija ("FLEXIVEL" vira "Flexível", "BOTAO" vira "Botão", "LAMPADA" vira "Lâmpada").
- NUNCA use abreviação. "C/" vira "Com", "P/" vira "Para", "S/" vira "Sem", "UND" vira "Unidade". Escreva tudo por extenso.
- Primeira letra de cada palavra em maiúscula, resto minúsculo. Conectivos (de, da, com, para, e, em) ficam minúsculos. Nada de CAIXA ALTA.
- Comece pelo tipo do produto, não pela marca.
- Cada opção deve destacar um ângulo DIFERENTE: uma pela aplicação/uso ("para Leitura"), outra pela forma de usar ("Direto na Tomada"), outra pelo tipo/formato do produto. É isso que faz o anúncio se destacar dos concorrentes.
- Só use informação que dê pra deduzir com segurança do nome e da categoria do produto. NUNCA invente voltagem, potência, material, medida, marca, quantidade de peças, certificação ou garantia que não estejam informados — título com dado falso gera reclamação e devolução.
- Máximo de ${maxCaracteres} caracteres por opção. Sem emoji, sem ponto final e sem palavra de propaganda vazia ("melhor", "imperdível", "promoção").`
}

// Aceita só o que a IA devolveu em formato utilizável: strings não vazias,
// dentro do limite da plataforma e sem repetição (a IA às vezes devolve a
// mesma frase com uma vírgula a mais).
export function validarTitulos(bruto: unknown, maxCaracteres: number): string[] {
  if (!Array.isArray(bruto)) return []
  const vistos = new Set<string>()
  const titulos: string[] = []
  for (const item of bruto) {
    if (typeof item !== 'string') continue
    const limpo = item.trim().replace(/\s+/g, ' ').replace(/[.\s]+$/, '')
    if (!limpo || limpo.length > maxCaracteres) continue
    const chave = limpo.toLowerCase()
    if (vistos.has(chave)) continue
    vistos.add(chave)
    titulos.push(limpo)
    if (titulos.length >= 3) break
  }
  return titulos
}
