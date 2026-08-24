import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { telaDoPathname } from '@/lib/auth/telas'

// Antigo `middleware.ts`. A convenção `middleware` foi deprecada e renomeada
// para `proxy` nesta versão do Next — só mudam o nome do arquivo e o da
// função, o comportamento é o mesmo.
//
// Este arquivo faz DUAS coisas que não se misturam, e a ordem importa:
//
//   1. ROTEAMENTO DA LOJA ONLINE (novo). Se o host é um subdomínio de loja,
//      reescreve para /loja/... e RETORNA. Requisição de vitrine não tem
//      sessão do ERP, e não deve pagar por uma consulta de autenticação.
//
//   2. GUARDA DO ERP (o que já existia). Sessão do Supabase, cabeçalho
//      x-pathname e controle de acesso por tela. Vale só para /dashboard,
//      /pdv, /saas-admin e /login — exatamente como antes.
//
// O `matcher` precisou ficar mais largo para alcançar as páginas da loja, e
// por isso o passo 2 confere o caminho antes de trabalhar: fora das rotas do
// ERP, a função devolve na primeira linha útil.

// ─── Loja Online: resolução por host ─────────────────────────────────────────

const CABECALHO_LOJA = 'x-loja-slug'

/** Mesmo valor de src/lib/commerce/loja.ts. Lido do ambiente porque o proxy
 *  não deve importar módulo pesado. */
const DOMINIO_RAIZ = process.env.NEXT_PUBLIC_LOJA_DOMINIO_RAIZ ?? ''

/** Subdomínios que pertencem à plataforma, nunca a uma loja. */
const RESERVADOS = new Set(['www', 'app', 'admin', 'api', 'painel', 'sistema', 'suporte'])

/** Caminhos do ERP. No domínio principal, ganham o guarda de sempre; num
 *  subdomínio de loja, são redirecionados para a vitrine. */
const ROTAS_ERP = ['/dashboard', '/pdv', '/saas-admin']

function slugDaLoja(host: string | null): string | null {
  if (!host) return null
  const limpo = host.split(':')[0].toLowerCase()

  if (limpo.endsWith('.localhost')) {
    const s = limpo.slice(0, -'.localhost'.length)
    return s && !RESERVADOS.has(s) ? s : null
  }

  if (DOMINIO_RAIZ && limpo.endsWith('.' + DOMINIO_RAIZ)) {
    const s = limpo.slice(0, -(DOMINIO_RAIZ.length + 1))
    // Sem subdomínio, reservado, ou com ponto (a.b.dominio) → não é loja.
    if (!s || RESERVADOS.has(s) || s.includes('.')) return null
    return s
  }

  // ── Domínio próprio de um cliente ────────────────────────
  //
  // FALHA FECHADO, e isto não é excesso de zelo: a versão anterior devolvia o
  // host inteiro como slug quando `DOMINIO_RAIZ` estava vazio. Em produção sem
  // a variável configurada, `www.sistemavargas.com.br` viraria "loja", o proxy
  // reescreveria o ERP INTEIRO para /loja/... e o site cairia em 404 —
  // dashboard incluído.
  //
  // O teste local nunca pegaria: `localhost` tem guarda própria logo abaixo.
  // Sem o domínio raiz configurado, portanto, NENHUM host é loja.
  if (!DOMINIO_RAIZ) return null
  if (limpo === DOMINIO_RAIZ || limpo === 'www.' + DOMINIO_RAIZ) return null
  if (limpo === 'localhost' || limpo.endsWith('.vercel.app')) return null
  return limpo
}

/**
 * Atalho de DESENVOLVIMENTO: `http://localhost:3000/?loja=bazareficaz`.
 *
 * Existe porque nem todo navegador resolve `*.localhost`, e sem isto a única
 * forma de abrir a vitrine na máquina seria mexer no arquivo hosts.
 *
 * Só funciona fora de produção — a Vercel define NODE_ENV='production' no
 * build, então lá esta função devolve null antes de olhar a URL.
 */
function slugDeDesenvolvimento(req: NextRequest): string | null {
  if (process.env.NODE_ENV === 'production') return null
  const q = req.nextUrl.searchParams.get('loja')
  return q && /^[a-z0-9-]{1,63}$/i.test(q) ? q.toLowerCase() : null
}

// ─── Proxy ───────────────────────────────────────────────────────────────────

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ══ 1. LOJA ONLINE ═════════════════════════════════════════════════════════
  const slugLoja = slugDaLoja(request.headers.get('host')) ?? slugDeDesenvolvimento(request)

  if (slugLoja) {
    // O subdomínio da loja não serve o ERP: quem chegar em
    // bazareficaz.dominio/dashboard vai para a vitrine, não para o painel.
    if (ROTAS_ERP.some(r => pathname.startsWith(r)) || pathname.startsWith('/login')) {
      return NextResponse.redirect(new URL('/', request.url))
    }

    const url = request.nextUrl.clone()
    url.pathname = `/loja${pathname}`

    const headers = new Headers(request.headers)
    headers.set(CABECALHO_LOJA, slugLoja)
    return NextResponse.rewrite(url, { request: { headers } })
  }

  // ══ 2. ERP ═════════════════════════════════════════════════════════════════
  //
  // SAÍDA ANTECIPADA. O matcher precisou ficar largo por causa da loja, mas o
  // trabalho abaixo — que inclui uma ida ao Supabase — continua valendo só
  // para as rotas que sempre valeu. Sem esta linha, a landing, o blog e as
  // páginas públicas passariam a pagar uma consulta de autenticação.
  const ehRotaErp = ROTAS_ERP.some(r => pathname.startsWith(r)) || pathname === '/login'
  if (!ehRotaErp) return NextResponse.next()

  // O endereço da tela precisa chegar até o layout do dashboard, que é quem
  // decide se o usuário pode abri-la. Server Component não enxerga a URL
  // sozinho; o caminho suportado é o proxy mandar num cabeçalho.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', pathname)

  let response = NextResponse.next({ request: { headers: requestHeaders } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request: { headers: requestHeaders } })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // ── SaaS Admin routes: require auth only (layout handles admin check) ─────────
  if (pathname.startsWith('/saas-admin')) {
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return response
  }

  // ── Dashboard + PDV routes: require auth ─────────────────────────────────────
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/pdv')) {
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    // Controle de acesso por tela.
    //
    // Precisa acontecer AQUI, e não só no layout do dashboard: no App Router o
    // layout não é renderizado de novo quando a navegação é por link (só o
    // conteúdo da página é buscado). Um guarda que morasse apenas no layout
    // pegaria o endereço digitado na barra e deixaria passar o clique num
    // link. O proxy roda nas duas situações.
    //
    // Custa uma consulta por navegação. Só busca as linhas de bloqueio, que
    // para quase todo usuário são zero.
    if (pathname.startsWith('/dashboard') && !pathname.startsWith('/dashboard/sem-acesso')) {
      const { data: bloqueios } = await supabase
        .from('usuario_permissoes')
        .select('codigo')
        .eq('usuario_id', user.id)
        .eq('permitido', false)
        .like('codigo', 'tela:%')

      if (bloqueios && bloqueios.length > 0) {
        const hrefsBloqueados = new Set(bloqueios.map(b => b.codigo.slice('tela:'.length)))
        // Resolve primeiro QUAL tela é este endereço, e só então pergunta se
        // ela está bloqueada — mesma função que o layout usa.
        //
        // O caminho inverso ("algum href bloqueado é prefixo deste endereço?")
        // parecia equivalente e não é: /dashboard é prefixo de todas as telas,
        // então bloquear a Visão Geral bloqueava o sistema inteiro.
        const tela = telaDoPathname(pathname)
        if (tela && hrefsBloqueados.has(tela.href)) {
          const destino = new URL('/dashboard/sem-acesso', request.url)
          destino.searchParams.set('de', pathname)
          return NextResponse.redirect(destino)
        }
      }
    }

    return response
  }

  // ── Login page: redirect authenticated users to dashboard ────────────────────
  if (pathname === '/login' && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return response
}

export const config = {
  // As quatro primeiras entradas são as de sempre, do guarda do ERP. A quinta
  // é o que a Loja Online acrescentou: as páginas da vitrine precisam passar
  // pelo proxy para serem reescritas.
  //
  // Fora dela: rota de API, artefato do Next e arquivo estático. Sem essa
  // exclusão o proxy rodaria também no /_next, que é o caminho mais quente da
  // aplicação.
  //
  // `sitemap.xml` NÃO está excluído, e isso é o oposto do que parece
  // intuitivo: na Loja Online ele é gerado POR LOJA (src/app/loja/sitemap.ts),
  // e é o proxy quem leva /sitemap.xml do subdomínio até lá.
  //
  // `robots.txt` está excluído pelo motivo contrário: o Next só reconhece
  // `robots.ts` na RAIZ de app/ (aninhado não gera rota — conferido no build).
  // Ele mora em src/app/robots.ts e resolve a loja pelo host sozinho.
  matcher: [
    '/dashboard/:path*',
    '/pdv/:path*',
    '/saas-admin/:path*',
    '/login',
    '/((?!api/|_next/|_vercel/|favicon.ico|robots.txt|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|css|js|woff|woff2|ttf|map)$).*)',
  ],
}
