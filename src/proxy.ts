import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { telaDoPathname } from '@/lib/auth/telas'

// Antigo `middleware.ts`. A convenção `middleware` foi deprecada e renomeada
// para `proxy` nesta versão do Next — só mudam o nome do arquivo e o da
// função, o comportamento é o mesmo.

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

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
  matcher: [
    '/dashboard/:path*',
    '/pdv/:path*',
    '/saas-admin/:path*',
    '/login',
  ],
}
