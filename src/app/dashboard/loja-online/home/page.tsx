import { contextoAdmin } from '@/lib/commerce/admin'

export const dynamic = 'force-dynamic'

// Banners e blocos da página inicial.
//
// Área deliberadamente SIMPLIFICADA nesta fase, e vale explicar por quê em
// vez de entregar uma tela pela metade sem aviso.
//
// A home já funciona sem configuração nenhuma: sem banner, ela mostra um
// bloco de abertura com o nome da loja; sem blocos configurados, ela monta
// "Ofertas" e "Novidades" sozinha. Ou seja, o valor de um editor aqui é
// AJUSTE FINO — e ajuste fino de vitrine antes de existir checkout é a
// definição de esforço na ordem errada.
//
// O que já está pronto por baixo (tabelas `loja_banners` e
// `loja_blocos_home`, com vigência, ordem e seleção manual de produtos) é o
// que permite montar este editor sem migração nenhuma quando for a hora.

export default async function HomeLoja() {
  const ctx = await contextoAdmin()
  if (!ctx?.lojaId) return null

  const [{ count: banners }, { count: blocos }] = await Promise.all([
    ctx.sb.from('loja_banners').select('id', { count: 'exact', head: true }).eq('loja_id', ctx.lojaId),
    ctx.sb.from('loja_blocos_home').select('id', { count: 'exact', head: true }).eq('loja_id', ctx.lojaId),
  ])

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="font-semibold text-gray-900">Como a página inicial está montada agora</h2>
        <ul className="mt-3 space-y-2 text-sm text-gray-600">
          <li className="flex gap-2">
            <span className="text-gray-400">1.</span>
            <span>
              <strong>Abertura</strong> —{' '}
              {(banners ?? 0) > 0
                ? `${banners} banner(s) cadastrado(s).`
                : 'sem banner: mostra o nome da loja, a descrição e um botão para o catálogo.'}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-gray-400">2.</span>
            <span><strong>Categorias</strong> — as principais da aba Categorias, com imagem quando houver.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-gray-400">3.</span>
            <span>
              <strong>Blocos de produto</strong> —{' '}
              {(blocos ?? 0) > 0
                ? `${blocos} bloco(s) configurado(s).`
                : 'sem configuração: monta “Ofertas” e “Novidades” automaticamente, e esconde os que ficariam vazios.'}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-gray-400">4.</span>
            <span><strong>Marcas</strong> — as mais presentes entre os produtos publicados e disponíveis.</span>
          </li>
        </ul>
      </section>

      <section className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <h2 className="font-semibold text-gray-900">Editor visual: próxima fase</h2>
        <p className="mt-1 text-sm text-gray-600">
          Cadastrar banner com vigência, reordenar blocos e montar seleção manual de produtos
          entram junto com o checkout. A estrutura no banco já existe e não vai precisar de
          migração — o que falta é só a tela.
        </p>
        <p className="mt-2 text-sm text-gray-600">
          Até lá, o que mais muda a cara da loja está em <strong>Aparência</strong> (logo e cores)
          e em <strong>Produtos</strong> (o que sobe para a vitrine).
        </p>
      </section>
    </div>
  )
}
