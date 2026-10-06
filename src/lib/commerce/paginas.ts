import { PAGAMENTO_LABEL } from './pedido'
import type { Loja } from './tipos'

// Páginas institucionais da vitrine.
//
// O texto nasce dos dados que a loja já preencheu (nome, contato, formas de
// receber e de pagar), e não de uma tabela nova: a loja ganha as páginas sem
// migração e sem ninguém digitar, e o que ela não configurou simplesmente não
// aparece. Texto que promete entrega quando a entrega está desligada é pior
// que página ausente.
//
// São textos-base, escritos para uma loja que combina entrega e pagamento
// pelo WhatsApp (o que o checkout faz hoje). Quando houver pagamento online
// ou frete calculado, estas frases precisam ser revistas.

export type SecaoPagina = { titulo?: string; paragrafos: string[]; itens?: string[] }

export type PaginaInstitucional = {
  slug: string
  /** Rótulo curto, usado no rodapé. */
  rotulo: string
  titulo: string
  descricao: string
  secoes: SecaoPagina[]
}

export const SLUGS_INSTITUCIONAIS = [
  'sobre-nos',
  'entrega-e-retirada',
  'formas-de-pagamento',
  'trocas-e-devolucoes',
  'privacidade',
] as const

function contato(loja: Loja): string[] {
  const l: string[] = []
  if (loja.whatsapp) l.push(`WhatsApp: ${loja.whatsapp}`)
  if (loja.telefone) l.push(`Telefone: ${loja.telefone}`)
  if (loja.email) l.push(`E-mail: ${loja.email}`)
  if (loja.horarioAtendimento) l.push(`Atendimento: ${loja.horarioAtendimento}`)
  return l
}

function local(loja: Loja): string | null {
  return [loja.cidade, loja.uf].filter(Boolean).join(' — ') || null
}

export function paginasDaLoja(loja: Loja): PaginaInstitucional[] {
  const canais = contato(loja)
  const cidade = local(loja)
  const formas = loja.pagamentoFormas.map(f => PAGAMENTO_LABEL[f] ?? f)

  const sobre: PaginaInstitucional = {
    slug: 'sobre-nos',
    rotulo: 'Sobre nós',
    titulo: `Sobre a ${loja.nome}`,
    descricao: `Conheça a ${loja.nome}${cidade ? `, de ${cidade}` : ''}.`,
    secoes: [
      {
        paragrafos: [
          loja.descricao
            ?? `A ${loja.nome} é uma loja${cidade ? ` de ${cidade}` : ''} que agora também atende pela internet.`,
          'Escolha os produtos, monte o pedido aqui no site e finalize em poucos passos. Nossa equipe separa o pedido e entra em contato para combinar os detalhes.',
        ],
      },
      ...(canais.length > 0
        ? [{ titulo: 'Fale com a gente', paragrafos: [], itens: canais }]
        : []),
    ],
  }

  const entrega: PaginaInstitucional = {
    slug: 'entrega-e-retirada',
    rotulo: 'Entrega e retirada',
    titulo: 'Entrega e retirada',
    descricao: `Como receber seu pedido da ${loja.nome}.`,
    secoes: [
      ...(loja.entregaAtiva
        ? [{
            titulo: 'Entrega',
            paragrafos: [
              'Informe o endereço completo no pedido. O valor e o prazo da entrega são combinados com a loja pelo WhatsApp e não estão incluídos no total mostrado no site.',
            ],
          }]
        : []),
      ...(loja.retiradaAtiva
        ? [{
            titulo: 'Retirada na loja',
            paragrafos: [
              `Você pode retirar o pedido na loja${cidade ? `, em ${cidade}` : ''}. Avisamos quando ele estiver separado.`,
            ],
          }]
        : []),
      {
        titulo: 'Disponibilidade',
        paragrafos: [
          'O estoque é conferido no momento em que você confirma o pedido. Se algum item acabar nesse intervalo, avisamos na hora, antes de concluir.',
        ],
      },
    ],
  }

  const pagamento: PaginaInstitucional = {
    slug: 'formas-de-pagamento',
    rotulo: 'Formas de pagamento',
    titulo: 'Formas de pagamento',
    descricao: `Como pagar seu pedido na ${loja.nome}.`,
    secoes: [
      {
        paragrafos: [
          'O pagamento não é feito no site. Ao confirmar o pedido, você escolhe como prefere pagar e combina o pagamento diretamente com a loja, na entrega ou na retirada.',
        ],
        ...(formas.length > 0 ? { itens: formas } : {}),
      },
    ],
  }

  const trocas: PaginaInstitucional = {
    slug: 'trocas-e-devolucoes',
    rotulo: 'Trocas e devoluções',
    titulo: 'Trocas e devoluções',
    descricao: 'Seus direitos em caso de troca, devolução ou defeito.',
    secoes: [
      {
        titulo: 'Desistência da compra',
        paragrafos: [
          'Por ser uma compra feita fora da loja física, você pode desistir em até 7 dias corridos contados do recebimento do produto, sem precisar explicar o motivo (art. 49 do Código de Defesa do Consumidor). O produto deve estar sem uso e, de preferência, na embalagem original.',
        ],
      },
      {
        titulo: 'Produto com defeito',
        paragrafos: [
          'Se o produto apresentar defeito, avise a loja o quanto antes. O prazo legal para reclamar é de 30 dias para produtos não duráveis e de 90 dias para duráveis, contados da entrega ou do aparecimento do defeito (art. 26 do CDC).',
        ],
      },
      {
        titulo: 'Como solicitar',
        paragrafos: [
          'Fale com a loja informando o número do pedido e o motivo.',
        ],
        ...(canais.length > 0 ? { itens: canais } : {}),
      },
    ],
  }

  const privacidade: PaginaInstitucional = {
    slug: 'privacidade',
    rotulo: 'Privacidade',
    titulo: 'Política de privacidade',
    descricao: `Como a ${loja.nome} trata os seus dados pessoais.`,
    secoes: [
      {
        paragrafos: [
          `Esta política explica como a ${loja.nome} trata os dados pessoais de quem faz pedidos neste site, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018).`,
        ],
      },
      {
        titulo: 'Quais dados coletamos',
        paragrafos: ['Coletamos apenas o necessário para atender seu pedido:'],
        itens: [
          'nome e telefone (WhatsApp), obrigatórios;',
          'CPF e e-mail, só se você informar;',
          'endereço, quando você escolhe receber em casa;',
          'os itens do pedido e a observação que você escrever.',
        ],
      },
      {
        titulo: 'Para que usamos',
        paragrafos: [
          'Usamos os dados para registrar e separar o pedido, combinar entrega e pagamento, emitir documento fiscal quando solicitado e responder dúvidas sobre a compra. Podemos enviar mensagens pelo WhatsApp sobre o seu pedido.',
          'Não vendemos nem compartilhamos seus dados com terceiros para fins de publicidade.',
        ],
      },
      {
        titulo: 'Cookies e armazenamento',
        paragrafos: [
          'O site guarda no seu navegador apenas o conteúdo do carrinho, para que ele não se perca ao navegar. Não usamos cookies de rastreamento nem de publicidade.',
        ],
      },
      {
        titulo: 'Seus direitos',
        paragrafos: [
          'Você pode pedir a confirmação de que tratamos seus dados, o acesso, a correção ou a exclusão deles, e deixar de receber mensagens, quando a lei permitir. Basta falar com a loja por um dos canais abaixo.',
        ],
        ...(canais.length > 0 ? { itens: canais } : {}),
      },
      {
        titulo: 'Por quanto tempo guardamos',
        paragrafos: [
          'Guardamos os dados do pedido pelo tempo necessário para atender a compra e cumprir obrigações legais, como as fiscais e as de garantia.',
        ],
      },
    ],
  }

  return [sobre, entrega, pagamento, trocas, privacidade]
}

export function paginaDaLoja(loja: Loja, slug: string): PaginaInstitucional | null {
  return paginasDaLoja(loja).find(p => p.slug === slug) ?? null
}
