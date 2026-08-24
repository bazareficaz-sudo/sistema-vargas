import Link from 'next/link'
import { contextoAdmin } from '@/lib/commerce/admin'
import CriarLoja from '@/components/loja-admin/CriarLoja'

// Painel da Loja Online.
//
// Oito áreas separadas, e não uma tela gigante de configuração: o pedido foi
// explícito, e é o certo. Uma página só com identidade + aparência + estoque
// + domínio + SEO vira um formulário de 40 campos onde ninguém acha nada, e
// onde salvar significa reescrever tudo.

const ABAS = [
  { href: '/dashboard/loja-online',               label: 'Visão Geral',    exato: true },
  { href: '/dashboard/loja-online/produtos',      label: 'Produtos' },
  { href: '/dashboard/loja-online/categorias',    label: 'Categorias' },
  { href: '/dashboard/loja-online/aparencia',     label: 'Aparência' },
  { href: '/dashboard/loja-online/home',          label: 'Banners / Home' },
  { href: '/dashboard/loja-online/estoque',       label: 'Estoque' },
  { href: '/dashboard/loja-online/dominio',       label: 'Domínio' },
  { href: '/dashboard/loja-online/configuracoes', label: 'Configurações' },
]

export default async function LayoutLojaOnline({ children }: { children: React.ReactNode }) {
  const ctx = await contextoAdmin()

  if (!ctx) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-600">Sessão sem empresa ativa.</p>
      </div>
    )
  }

  // Empresa sem loja: em vez de uma tela vazia ou de um erro, o caminho para
  // criar. É a mesma empresa ativa do resto do painel — nenhuma escolha de
  // empresa acontece aqui.
  if (!ctx.lojaId) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="text-xl font-bold text-gray-900">Loja Online</h1>
        <CriarLoja />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">Loja Online</h1>
      </div>

      {/* Rolagem horizontal no celular: 8 abas não cabem em 375px, e quebrar
          em duas linhas empurra o conteúdo para baixo da dobra. */}
      <nav className="mb-5 -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="flex gap-1 border-b border-gray-200">
          {ABAS.map(a => (
            <Link
              key={a.href}
              href={a.href}
              className="whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900"
            >
              {a.label}
            </Link>
          ))}
        </div>
      </nav>

      {children}
    </div>
  )
}
