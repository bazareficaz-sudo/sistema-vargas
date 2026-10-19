import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { NAV, ALL_ITEMS } from '../../src/components/nav-config'

// O MENU CRESCEU POR CAMADAS, E NINGUÉM CONFERIA.
//
// O sistema ganhou formas de pagamento, contas a pagar, contas a receber,
// cobrança e carteira de cliente em momentos diferentes, e cada recurso novo
// entrou no menu que fazia sentido naquela semana. O resultado, medido em
// 18/10/2026: a tela de Tipos de Despesa existia, funcionava e NÃO estava no
// menu — chegava-se nela só por um link dentro do Contas a Pagar.
//
// O próprio nav-config.ts já avisava, num comentário:
//
//     "Sem entrada no menu a tela nasce orfa — foi o que aconteceu com a
//      rota de carga do NCM, que existiu tres dias sem ninguem poder chamar."
//
// O aviso não bastou, porque era comentário. Este arquivo é o aviso virado
// teste: arrumar o menu uma vez não impede a bagunça voltar; conferir a cada
// `npm test` impede.

const raiz = path.resolve(__dirname, '..', '..')

/** O arquivo de página que atende este endereço, se existir. */
function paginaDe(href: string): string | null {
  const p = path.join(raiz, 'src', 'app', href, 'page.tsx')
  return fs.existsSync(p) ? p : null
}

/** Todas as páginas sob src/app/dashboard, como endereços. */
function paginasDoPainel(): string[] {
  const base = path.join(raiz, 'src', 'app', 'dashboard')
  const achadas: string[] = []
  const andar = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const cheio = path.join(dir, e.name)
      if (e.isDirectory()) andar(cheio)
      else if (e.name === 'page.tsx') {
        achadas.push('/' + path.relative(path.join(raiz, 'src', 'app'), dir).split(path.sep).join('/'))
      }
    }
  }
  andar(base)
  return achadas.sort()
}

describe('nenhum item de menu aponta para tela que não existe', () => {
  // O bug espelho da tela órfã: o item aparece, a pessoa clica e toma 404.
  // Mais embaraçoso que a órfã, porque é visível para todo mundo.
  for (const item of ALL_ITEMS) {
    test(`${item.group} › ${item.label}`, () => {
      assert.ok(paginaDe(item.href), `${item.href} não tem page.tsx`)
    })
  }
})

describe('nenhum endereço de menu carrega query', () => {
  test('o catálogo de permissões é montado a partir destes endereços', () => {
    // lib/auth/telas.ts resolve a tela comparando o PATHNAME com o href do
    // menu. Um href com `?aba=taxas` não casa com pathname nenhum: a tela
    // sairia do catálogo e ficaria IMPOSSÍVEL de bloquear em Usuários →
    // Permissões, sem nenhum erro aparecer. Quando duas entradas precisam
    // abrir partes diferentes da mesma tela, cada uma é uma página de
    // verdade — ver /dashboard/financeiro/taxas.
    const comQuery = ALL_ITEMS.filter(i => i.href.includes('?') || i.href.includes('#'))
    assert.deepEqual(comQuery.map(i => i.href), [])
  })
})

describe('nenhuma tela do painel é inalcançável', () => {
  // Não exige estar no menu: muitas telas se chega por dentro de outra, de
  // propósito (o detalhe da entrada, a consulta do endereçamento). O que não
  // pode é NINGUÉM apontar para ela — aí a tela existe só no disco.
  const noMenu = new Set(ALL_ITEMS.map(i => i.href))

  // Telas que NÃO devem ser apontadas por ninguém, e por quê. Cada linha é
  // uma decisão, não uma exceção de conveniência: entrar aqui obriga a
  // escrever o motivo.
  const FORA_DE_PROPOSITO: Record<string, string> = {
    '/dashboard/getulio': 'redirect do nome antigo da assistente, de pé só para favoritos e links já enviados',
    '/dashboard/sem-acesso': 'destino de quem foi barrado; linkar seria convidar a ir',
  }

  // Lido uma vez: são ~1.400 arquivos, e ler por teste deixaria a suíte lenta.
  const fontes: string[] = []
  const varrer = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const cheio = path.join(dir, e.name)
      if (e.isDirectory()) { varrer(cheio); continue }
      if (/\.(ts|tsx)$/.test(e.name)) fontes.push(fs.readFileSync(cheio, 'utf8'))
    }
  }
  varrer(path.join(raiz, 'src'))

  for (const href of paginasDoPainel()) {
    // Endereço com segmento dinâmico não é digitável nem linkável como texto
    // fixo: quem chega nele vem de uma lista, montando a URL.
    if (href.includes('[')) continue
    test(href, () => {
      if (noMenu.has(href)) return
      if (FORA_DE_PROPOSITO[href]) return
      // A fronteira depois do endereço aceita `?` e `#` porque link pode
      // levar parâmetro — `/dashboard/publicar-lote?canal=…` é como se chega
      // na publicação em lote, e exigir a aspa fechando logo após o caminho
      // dava essa tela como inalcançável. Não aceita `/`: senão um link para
      // `/dashboard/contas-pagar/relatorio` faria a tela pai passar de graça.
      const alvo = new RegExp(`['"\`]${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=['"\`?#])`)
      assert.ok(fontes.some(f => alvo.test(f)),
        `${href} não está no menu e nenhum arquivo aponta para ela`)
    })
  }
})

describe('o Financeiro reúne o que é financeiro', () => {
  const financeiro = NAV.find(g => g.id === 'financeiro')!
  const hrefs = (financeiro.subGroups ?? []).flatMap(sg => sg.items.map(i => i.href))

  test('o grupo existe e tem subgrupos', () => {
    assert.ok(financeiro, 'grupo financeiro desapareceu')
    assert.ok((financeiro.subGroups ?? []).length >= 4, `subgrupos=${(financeiro.subGroups ?? []).length}`)
  })

  // A lista que esta reorganização garantiu. Tela financeira que nascer fora
  // daqui depois não é erro de digitação: é a bagunça recomeçando, e o teste
  // obriga a decisão a ser explícita.
  for (const href of [
    '/dashboard/financeiro',
    '/dashboard/contas-receber',
    '/dashboard/carteira-clientes',
    '/dashboard/cobranca',
    '/dashboard/creditos-clientes',
    '/dashboard/contas-pagar',
    '/dashboard/configuracoes/tipos-despesa',
    '/dashboard/financeiro/taxas',
  ]) {
    test(`inclui ${href}`, () => {
      assert.ok(hrefs.includes(href), `${href} não está no menu Financeiro`)
    })
  }

  test('Tipos de Despesa está em Pagar, junto do que ela classifica', () => {
    const pagar = (financeiro.subGroups ?? []).find(sg => sg.label === 'Pagar')
    assert.ok(pagar, 'subgrupo Pagar desapareceu')
    assert.ok(pagar!.items.some(i => i.href === '/dashboard/configuracoes/tipos-despesa'))
  })

  test('as taxas ficam num subgrupo de cadastro, não soltas em Relatórios', () => {
    const cad = (financeiro.subGroups ?? []).find(sg => sg.label === 'Cadastros e Taxas')
    assert.ok(cad, 'subgrupo Cadastros e Taxas desapareceu')
    assert.deepEqual(cad!.items.map(i => i.href), ['/dashboard/financeiro/taxas'])
  })
})

describe('a Saúde da Venda continua no Comercial', () => {
  test('a régua de desconto é ferramenta de venda, e fica onde se vende', () => {
    // Só as TAXAS mudaram de menu. Levar as faixas junto tiraria do gerente
    // de balcão a tela que ele usa todo dia.
    const comercial = NAV.find(g => g.id === 'comercial')!
    assert.ok(comercial.items!.some(i => i.href === '/dashboard/configuracoes/saude-venda'))
  })

  test('e as duas telas apontam para páginas diferentes', () => {
    // Mesmo componente, mesma linha de `saude_config`, endereços distintos —
    // é o que permite bloquear uma e liberar a outra em Permissões.
    assert.ok(paginaDe('/dashboard/configuracoes/saude-venda'))
    assert.ok(paginaDe('/dashboard/financeiro/taxas'))
  })
})
