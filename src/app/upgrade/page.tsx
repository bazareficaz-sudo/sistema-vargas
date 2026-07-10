import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default async function UpgradePage() {
  const supabase = await createClient()
  const { data: plans } = await supabase
    .from('plans')
    .select('*, plan_modules(modulo), plan_limits(*)')
    .eq('publico', true).eq('ativo', true).order('ordem')

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-slate-800">Escolha seu plano</h1>
          <p className="text-slate-500 mt-2">Faça upgrade para desbloquear mais recursos para sua empresa</p>
        </div>

        <div className="grid grid-cols-3 gap-5">
          {(plans ?? []).map(p => {
            const mods = (p.plan_modules as { modulo: string }[])?.map(m => m.modulo) ?? []
            const limits = Array.isArray(p.plan_limits) ? p.plan_limits[0] : p.plan_limits
            return (
              <div key={p.id} className={`bg-white rounded-2xl border-2 p-6 shadow-sm relative ${p.recomendado ? 'border-blue-500' : 'border-slate-200'}`}>
                {p.recomendado && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                    ★ Recomendado
                  </div>
                )}
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ background: p.cor }} />
                  <h2 className="font-bold text-slate-800 text-lg">{p.nome}</h2>
                </div>
                <p className="text-slate-500 text-sm mb-4">{p.descricao}</p>
                <div className="text-3xl font-bold text-slate-800 mb-1">
                  {brl(p.preco_mensal)}<span className="text-base font-normal text-slate-400">/mês</span>
                </div>
                {p.permite_trial && (
                  <p className="text-sm text-emerald-600 mb-4">✓ {p.dias_trial} dias grátis</p>
                )}
                <ul className="space-y-1.5 mb-6">
                  {mods.slice(0, 10).map(m => (
                    <li key={m} className="flex items-center gap-2 text-sm text-slate-600">
                      <span className="text-emerald-500 text-xs">✓</span>
                      <span className="capitalize">{m.replace('_', ' ')}</span>
                    </li>
                  ))}
                  {limits && (
                    <>
                      <li className="flex items-center gap-2 text-sm text-slate-600">
                        <span className="text-emerald-500 text-xs">✓</span>
                        {limits.max_usuarios === -1 ? 'Usuários ilimitados' : `Até ${limits.max_usuarios} usuários`}
                      </li>
                      <li className="flex items-center gap-2 text-sm text-slate-600">
                        <span className="text-emerald-500 text-xs">✓</span>
                        {limits.max_produtos === -1 ? 'Produtos ilimitados' : `Até ${Number(limits.max_produtos).toLocaleString()} produtos`}
                      </li>
                    </>
                  )}
                </ul>
                <a href={`https://wa.me/5500000000000?text=Quero+contratar+o+plano+${p.nome}`} target="_blank" rel="noreferrer"
                  className={`w-full block text-center py-3 rounded-xl text-sm font-bold transition-colors ${p.recomendado ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}>
                  Começar agora
                </a>
              </div>
            )
          })}
        </div>

        <div className="text-center mt-8">
          <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-700">← Voltar ao sistema</Link>
        </div>
      </div>
    </div>
  )
}
