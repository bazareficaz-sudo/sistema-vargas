import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import NovoClienteBotao from '@/components/clientes/NovoClienteBotao'
import GerenciarCategorias from '@/components/clientes/GerenciarCategorias'
import ClientesTabela, { type LinhaCliente } from '@/components/clientes/ClientesTabela'
import { corValida, emOrdem, type Categoria } from '@/lib/clientes/categorias'
import { linksDasFotos } from '@/lib/clientes/foto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLUNAS = 'id, nome, cpf_cnpj, telefone, cidade, estado, saldo_credito, saldo_devedor, status_credito, ativo'
const COLUNA_FOTO = ', foto_path'

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string; cat?: string }>
}) {
  const { q = '', pagina = '1', cat: catBruta = '' } = await searchParams
  const cat = UUID.test(catBruta) ? catBruta : ''
  const pg = Math.max(1, parseInt(pagina))
  const POR_PAGINA = 50
  const offset = (pg - 1) * POR_PAGINA

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id

  // Categorias do cliente vêm junto (cats); filtrar por uma usa o vínculo
  // obrigatório (filtro). Sem a tabela de categorias, lista sem elas.
  const montar = (comCategorias: boolean) => {
    let query = supabase
      .from('clientes')
      .select(comCategorias
        ? `${COLUNAS}${COLUNA_FOTO}, cats:cliente_categoria_vinculos(categoria_id)${cat ? ', filtro:cliente_categoria_vinculos!inner(categoria_id)' : ''}`
        : COLUNAS, { count: 'exact' })
      .eq('empresa_id', empresaId)
      // Cadastro unificado noutro não aparece: continua no banco pelo
      // histórico, mas listá-lo faz o mesmo cliente surgir duas vezes — foi
      // o que aconteceu com o ESCRITORIO ROCHA RANGEL depois de unificado
      // (ver supabase-cliente-mesclado-redirecionar.sql).
      .is('mesclado_em', null)
      .order('nome')
      .range(offset, offset + POR_PAGINA - 1)
    if (comCategorias && cat) query = query.eq('filtro.categoria_id', cat)

    // Buscar só por nome obrigava a saber como o cliente foi cadastrado.
    // Documento e telefone são o que o balconista tem na mão.
    if (q) {
      const digitos = q.replace(/\D/g, '')
      const alvos = [`nome.ilike.%${q}%`]
      if (digitos.length >= 3) {
        alvos.push(`cpf_cnpj.ilike.%${digitos}%`, `telefone.ilike.%${digitos}%`)
      }
      query = query.or(alvos.join(','))
    }
    return query
  }

  const [res, contagemRes] = await Promise.all([
    montar(true),
    supabase.from('cliente_categorias_contagem').select('id, nome, cor, clientes').eq('empresa_id', empresaId),
  ])
  const { data, count } = res.error ? await montar(false) : res
  type Linha = Omit<LinhaCliente, 'categorias' | 'foto_url'> & { cats?: { categoria_id: string }[]; foto_path?: string | null }
  const linhas = (data ?? []) as unknown as Linha[]
  const fotos = await linksDasFotos(supabase, linhas.map(c => c.foto_path))
  const clientes: LinhaCliente[] = linhas.map(({ cats, foto_path, ...c }) => ({
    ...c, categorias: (cats ?? []).map(v => v.categoria_id), foto_url: foto_path ? fotos.get(foto_path) ?? null : null,
  }))
  const categorias: Categoria[] = emOrdem((contagemRes.data ?? []).map(c => ({ id: c.id, nome: c.nome, cor: corValida(c.cor) })))
  const contagem = Object.fromEntries((contagemRes.data ?? []).map(c => [c.id, Number(c.clientes ?? 0)]))
  const totalPaginas = Math.ceil((count ?? 0) / POR_PAGINA)
  const catAtual = categorias.find(c => c.id === cat)
  const link = (p: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(cat ? { cat } : {}), pagina: String(p) })}`

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Clientes</h1>
          <p className="text-gray-500 text-sm mt-0.5">{count?.toLocaleString('pt-BR')} clientes {catAtual ? `em ${catAtual.nome}` : 'cadastrados'}</p>
        </div>
        <div className="flex gap-2">
          <GerenciarCategorias empresaId={empresaId ?? ''} categorias={categorias} contagem={contagem} />
          <NovoClienteBotao empresaId={empresaId ?? ''} />
        </div>
      </div>

      <form className="mb-4">
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar por nome, CPF/CNPJ ou telefone..."
          className="bg-white border border-gray-300 text-gray-800 rounded-lg px-4 py-2 text-sm w-72 focus:outline-none focus:border-blue-500 placeholder-gray-400"
        />
        {categorias.length > 0 && (
          <select name="cat" defaultValue={cat}
            className="ml-2 bg-white border border-gray-300 text-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
            <option value="">Todas as categorias</option>
            {categorias.map(c => <option key={c.id} value={c.id}>{c.nome} ({contagem[c.id] ?? 0})</option>)}
          </select>
        )}
        <button type="submit" className="ml-2 bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg transition-colors">
          Buscar
        </button>
        {(q || cat) && <Link href="/dashboard/clientes" className="ml-2 text-sm text-gray-500 hover:underline">Limpar</Link>}
      </form>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <ClientesTabela clientes={clientes} categorias={categorias} empresaId={empresaId ?? ''} />

        {totalPaginas > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <p className="text-gray-500 text-xs">Página {pg} de {totalPaginas}</p>
            <div className="flex gap-2">
              {pg > 1 && <a href={link(pg - 1)} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">← Anterior</a>}
              {pg < totalPaginas && <a href={link(pg + 1)} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">Próxima →</a>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
