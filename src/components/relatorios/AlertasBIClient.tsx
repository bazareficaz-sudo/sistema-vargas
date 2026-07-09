'use client'

import Link from 'next/link'

type Alerta = {
  tipo: 'critico' | 'alerta' | 'info' | 'oportunidade'
  titulo: string; descricao: string; quantidade?: number; link?: string; valor?: string
}

const TIPO_CFG = {
  critico:      { icon: '🔴', label: 'Crítico',       cls: 'bg-red-50 border-red-200',     badge: 'bg-red-100 text-red-700',     ring: 'ring-red-200' },
  alerta:       { icon: '⚠️', label: 'Alerta',        cls: 'bg-orange-50 border-orange-200', badge: 'bg-orange-100 text-orange-700', ring: 'ring-orange-200' },
  info:         { icon: 'ℹ️', label: 'Info',          cls: 'bg-blue-50 border-blue-200',    badge: 'bg-blue-100 text-blue-700',   ring: 'ring-blue-200' },
  oportunidade: { icon: '💡', label: 'Oportunidade',  cls: 'bg-emerald-50 border-emerald-200', badge: 'bg-emerald-100 text-emerald-700', ring: 'ring-emerald-200' },
}

export default function AlertasBIClient({
  alertas, totalProdutos, totalClientes,
}: {
  alertas: Alerta[]
  totalProdutos: number
  totalClientes: number
}) {
  const criticos = alertas.filter(a => a.tipo === 'critico')
  const alertasWarn = alertas.filter(a => a.tipo === 'alerta')
  const infos = alertas.filter(a => a.tipo === 'info')
  const oportunidades = alertas.filter(a => a.tipo === 'oportunidade')

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>relatórios & BI</span><span>›</span>
        <span className="text-gray-600 font-medium">alertas inteligentes</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Alertas Inteligentes</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {alertas.length} alertas gerados automaticamente — base: {totalProdutos} produtos, {totalClientes} clientes
          </p>
        </div>
        <span className="text-xs bg-yellow-50 text-yellow-700 border border-yellow-200 px-3 py-1.5 rounded-full font-medium">
          🔔 Atualizado agora
        </span>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Críticos', val: criticos.length, icon: '🔴', cls: 'bg-red-50 border-red-200 text-red-700' },
          { label: 'Alertas', val: alertasWarn.length, icon: '⚠️', cls: 'bg-orange-50 border-orange-200 text-orange-700' },
          { label: 'Informativos', val: infos.length, icon: 'ℹ️', cls: 'bg-blue-50 border-blue-200 text-blue-700' },
          { label: 'Oportunidades', val: oportunidades.length, icon: '💡', cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
        ].map(k => (
          <div key={k.label} className={`rounded-2xl border shadow-sm p-4 ${k.cls}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">{k.icon}</span>
              <span className="text-xs font-semibold uppercase tracking-wide">{k.label}</span>
            </div>
            <p className="text-3xl font-bold">{k.val}</p>
          </div>
        ))}
      </div>

      {alertas.length === 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-10 text-center">
          <p className="text-4xl mb-3">🎉</p>
          <p className="text-emerald-700 font-semibold text-lg">Tudo em ordem!</p>
          <p className="text-emerald-600 text-sm mt-1">Nenhum alerta crítico identificado no momento.</p>
        </div>
      )}

      {/* Alertas por categoria */}
      {[
        { lista: criticos, titulo: '🔴 Críticos — ação imediata necessária' },
        { lista: alertasWarn, titulo: '⚠️ Alertas — atenção recomendada' },
        { lista: infos, titulo: 'ℹ️ Informativos' },
        { lista: oportunidades, titulo: '💡 Oportunidades' },
      ].map(({ lista, titulo }) => lista.length > 0 && (
        <div key={titulo} className="mb-8">
          <h2 className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-2">
            {titulo}
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{lista.length}</span>
          </h2>
          <div className="space-y-3">
            {lista.map((a, i) => {
              const cfg = TIPO_CFG[a.tipo]
              return (
                <div key={i} className={`rounded-2xl border ${cfg.cls} p-5 flex items-start gap-4`}>
                  <span className="text-2xl flex-shrink-0 mt-0.5">{cfg.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-semibold text-gray-900">{a.titulo}</h3>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
                      {a.quantidade !== undefined && (
                        <span className="text-xs bg-white/70 text-gray-600 px-2 py-0.5 rounded-full border border-gray-200">
                          {a.quantidade.toLocaleString('pt-BR')} itens
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">{a.descricao}</p>
                    {a.valor && (
                      <p className="text-sm font-bold text-gray-900 mt-1">Valor: {a.valor}</p>
                    )}
                  </div>
                  {a.link && (
                    <Link href={a.link}
                      className="flex-shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800 bg-white/70 border border-blue-200 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap">
                      Ver detalhes →
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
