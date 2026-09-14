import { contextoAdmin } from '@/lib/commerce/admin'
import BannersClient from '@/components/loja-admin/BannersClient'
import BlocosHomeClient from '@/components/loja-admin/BlocosHomeClient'

export const dynamic = 'force-dynamic'

// Banners e blocos da página inicial.
//
// Até aqui esta tela só CONTAVA como a home estava montada — não editava
// nada, porque ajuste fino de vitrine antes de existir checkout era esforço
// na ordem errada (ver o histórico no CONTINUIDADE.md). As tabelas sempre
// estiveram prontas; faltava a tela, que é o que os dois componentes abaixo
// entregam.

export default async function HomeLoja() {
  const ctx = await contextoAdmin()
  if (!ctx?.lojaId) return null

  const [{ data: banners }, { data: blocos }, { data: tagsRows }] = await Promise.all([
    ctx.sb.from('loja_banners').select('*').eq('loja_id', ctx.lojaId).order('ordem'),
    ctx.sb.from('loja_blocos_home').select('*').eq('loja_id', ctx.lojaId).order('ordem'),
    // Mesma consulta que alimenta o filtro de tags em Dashboard → Produtos:
    // é o inventário de tags que já existe, não uma lista nova.
    ctx.sb.from('produtos').select('tags').eq('empresa_id', ctx.empresaId).not('tags', 'eq', '{}'),
  ])

  const tagsDisponiveis = Array.from(
    new Set<string>((tagsRows ?? []).flatMap((r: any) => (r.tags ?? []) as string[])),
  ).sort()

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="font-semibold text-gray-900">Como a página inicial está montada</h2>
        <ul className="mt-3 space-y-2 text-sm text-gray-600">
          <li className="flex gap-2">
            <span className="text-gray-400">1.</span>
            <span>
              <strong>Abertura</strong> — o banner ativo com a menor ordem, dentro da vigência.
              Sem nenhum, mostra o nome da loja, a descrição e um botão para o catálogo.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-gray-400">2.</span>
            <span><strong>Categorias</strong> — as principais da aba Categorias, com imagem quando houver.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-gray-400">3.</span>
            <span>
              <strong>Blocos de produto</strong> — os configurados abaixo, na ordem escolhida.
              Sem nenhum, monta "Ofertas" e "Novidades" automaticamente.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-gray-400">4.</span>
            <span><strong>Marcas</strong> — as mais presentes entre os produtos publicados e disponíveis.</span>
          </li>
        </ul>
      </section>

      <BannersClient lojaId={ctx.lojaId} banners={banners ?? []} />
      <BlocosHomeClient lojaId={ctx.lojaId} blocos={blocos ?? []} tagsDisponiveis={tagsDisponiveis} />
    </div>
  )
}
