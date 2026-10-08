// O pedido à IA da tela de Prontidão: peso e medidas da embalagem e
// descrição, em lote. Separado da rota para poder ser ensaiado com produtos
// reais antes de mudar.
export function promptProntidao(entrada: { id: string; nome: string; marca: string | null; categoria: string | null }[], blocoPadrao: string): string {
  return `Você ajuda a preparar o cadastro de produtos de uma loja de ferragens, material elétrico, utilidades e bazar para anunciar em marketplaces (Mercado Livre, Shopee, TikTok Shop).

Para CADA produto abaixo, estime com base no nome:
- o peso do produto JÁ EMBALADO para envio, em kg;
- as medidas da embalagem (comprimento, largura e altura), em cm;
- uma descrição para o anúncio em português do Brasil: 2 a 4 frases, entre 120 e 450 caracteres, dizendo o que é, para que serve e o que vem — SEM inventar especificação que não esteja no nome (voltagem, material, quantidade, garantia). Sem emojis, sem CAIXA ALTA, sem preço.

Seja realista: um parafuso avulso pesa gramas; um kit com 100 unidades, mais; um galão de 3,6 L de tinta pesa ~4,5 kg. Se o nome não der para estimar com alguma segurança, use null naquele campo.

Produtos: ${JSON.stringify(entrada)}
${blocoPadrao}
Responda SOMENTE com JSON: {"itens":[{"id":"...","peso_kg":0.1,"comprimento_cm":10,"largura_cm":5,"altura_cm":3,"descricao":"..."}]}`
}
