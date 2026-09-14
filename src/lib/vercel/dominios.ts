// Cliente fino da API REST da Vercel, só para o que a aba Domínio precisa:
// anexar o domínio do cliente ao projeto e checar se o DNS já aponta certo.
//
// Por que isto não usa `VERCEL_OIDC_TOKEN` (que já existe em `.env.local`
// desde o `vercel env pull`): esse token é para federação com OUTROS
// provedores (AI Gateway, Vercel Connect) — a própria documentação da Vercel
// só mostra um Personal Access Token (`vca_...`) como credencial válida para
// `Authorization: Bearer` nesta API REST de projetos/domínios. Por isso a
// rota exige `VERCEL_API_TOKEN` à parte, gerado uma vez em
// vercel.com/account/tokens e configurado como variável de ambiente — no
// projeto (para o painel em produção) e em `.env.local` (para testar local).
//
// `VERCEL_PROJECT_ID` e `VERCEL_TEAM_ID` não são segredo — são só o
// endereço do projeto — por isso têm um valor padrão aqui, e só precisam de
// variável de ambiente se este repositório for implantado numa conta ou
// projeto diferente.

const BASE = 'https://api.vercel.com'
const PROJETO = process.env.VERCEL_PROJECT_ID || 'prj_uQqrPgV6o0VP26KrXKWR8mlLJgds'
const TIME = process.env.VERCEL_TEAM_ID || 'team_CpZgdxwWn3tucgdm0sEJArQW'

const HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/

/** Mesma limpeza da rota `/api/loja-admin/config` (tipo `host`): aceita
 *  colar a URL inteira, mas guarda só o hostname. */
export function sanitizarHost(bruto: unknown): string | null {
  if (typeof bruto !== 'string') return null
  const h = bruto.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  return HOST.test(h) ? h : null
}

export function vercelConfigurado(): boolean {
  return !!process.env.VERCEL_API_TOKEN
}

class ErroVercel extends Error {}

async function chamar<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  const token = process.env.VERCEL_API_TOKEN
  if (!token) {
    throw new ErroVercel(
      'Falta configurar VERCEL_API_TOKEN nas variáveis de ambiente. ' +
      'Gere um token em vercel.com/account/tokens e adicione ao projeto na Vercel.',
    )
  }
  const url = `${BASE}${caminho}${caminho.includes('?') ? '&' : '?'}teamId=${TIME}`
  const res = await fetch(url, {
    ...opcoes,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  const corpo = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = corpo?.error?.message || `Falha na API da Vercel (${res.status})`
    throw new ErroVercel(msg)
  }
  return corpo as T
}

export type RegistrosRecomendados = {
  /** IPv4 para um registro tipo A — usado quando o domínio é a RAIZ (sem subdomínio). */
  recommendedIPv4: string[]
  /** Alvo para um registro tipo CNAME — usado quando o domínio TEM subdomínio (ex: www, loja). */
  recommendedCNAME: string[]
  misconfigured: boolean
}

export type StatusDominio = RegistrosRecomendados & {
  verificadoNoProjeto: boolean
  apex: boolean
  apexName: string
  desafios: { type: string; domain: string; value: string; reason?: string }[]
}

/**
 * Anexa o domínio ao projeto na Vercel. Idempotente na prática: se o domínio
 * já está anexado a ESTE projeto, a Vercel devolve 400 com um código
 * reconhecível — tratamos como sucesso e seguimos para o status, em vez de
 * mostrar erro para quem só está clicando de novo.
 */
export async function adicionarDominio(dominio: string): Promise<StatusDominio> {
  try {
    await chamar(`/v10/projects/${PROJETO}/domains`, {
      method: 'POST',
      body: JSON.stringify({ name: dominio }),
    })
  } catch (e) {
    const jaExiste = e instanceof ErroVercel && /already in use|already exists/i.test(e.message)
    if (!jaExiste) throw e
  }
  return statusDominio(dominio)
}

/**
 * Junta duas respostas da Vercel: a config de DNS (aponta certo?) e o
 * domínio do projeto (é reconhecido como deste projeto?). São perguntas
 * diferentes — um domínio pode apontar certo e ainda não ter passado pelo
 * desafio de posse, se já foi usado noutro projeto/conta antes.
 */
export async function statusDominio(dominio: string): Promise<StatusDominio> {
  const [config, projeto] = await Promise.all([
    chamar<{ misconfigured: boolean; recommendedIPv4?: string[]; recommendedCNAME?: string[] }>(
      `/v6/domains/${dominio}/config?strict=false`,
    ),
    chamar<{ verified: boolean; apexName: string; verification?: { type: string; domain: string; value: string; reason?: string }[] }>(
      `/v9/projects/${PROJETO}/domains/${dominio}`,
    ),
  ])

  return {
    misconfigured: config.misconfigured,
    recommendedIPv4: config.recommendedIPv4 ?? ['76.76.21.21'],
    recommendedCNAME: config.recommendedCNAME ?? ['cname.vercel-dns.com'],
    verificadoNoProjeto: projeto.verified,
    apex: dominio === projeto.apexName,
    apexName: projeto.apexName,
    desafios: projeto.verification ?? [],
  }
}

/** Remove o domínio do projeto. Usado quando o lojista troca de domínio. */
export async function removerDominio(dominio: string): Promise<void> {
  try {
    await chamar(`/v9/projects/${PROJETO}/domains/${dominio}`, { method: 'DELETE' })
  } catch (e) {
    // Já não estar mais lá não é erro para quem pediu para remover.
    const naoEncontrado = e instanceof ErroVercel && /not found/i.test(e.message)
    if (!naoEncontrado) throw e
  }
}
