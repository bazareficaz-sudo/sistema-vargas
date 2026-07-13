'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

const PLATAFORMAS: Record<string, { label: string; icone: string; cor: string }> = {
  mercadolivre: { label: 'Mercado Livre', icone: '🛒', cor: 'bg-yellow-400' },
  shopee:       { label: 'Shopee',        icone: '🧡', cor: 'bg-orange-500' },
  amazon:       { label: 'Amazon',        icone: '📦', cor: 'bg-orange-400' },
  magalu:       { label: 'Magazine Luiza',icone: '🛍️', cor: 'bg-blue-600'  },
  outro:        { label: 'Outro',         icone: '🏪', cor: 'bg-gray-500'   },
}

export default function CanalConfigClient({ canal: canalInicial, logs, empresaId }: {
  canal: any; logs: any[]; empresaId: string
}) {
  const router = useRouter()
  const plat = PLATAFORMAS[canalInicial.plataforma] ?? PLATAFORMAS.outro
  const [salvando, setSalvando] = useState(false)
  const [ok, setOk] = useState('')
  const [erro, setErro] = useState('')
  const [testando, setTestando] = useState(false)
  const [form, setForm] = useState({
    nome: canalInicial.nome,
    markup_canal: String(canalInicial.markup_canal ?? 0),
    seller_id: canalInicial.seller_id ?? '',
    sincronizar_estoque: canalInicial.sincronizar_estoque ?? true,
    sincronizar_preco: canalInicial.sincronizar_preco ?? true,
  })

  function f(k: string, v: any) { setForm(p => ({ ...p, [k]: v })) }
  function flash(msg: string) { setOk(msg); setTimeout(() => setOk(''), 3000) }

  async function salvar() {
    if (!form.nome.trim()) { setErro('Nome obrigatório.'); return }
    setSalvando(true); setErro('')
    const sb = createClient()
    await sb.from('marketplace_canais').update({
      nome: form.nome.trim(),
      markup_canal: parseFloat(form.markup_canal) || 0,
      seller_id: form.seller_id || null,
      sincronizar_estoque: form.sincronizar_estoque,
      sincronizar_preco: form.sincronizar_preco,
      updated_at: new Date().toISOString(),
    }).eq('id', canalInicial.id)
    setSalvando(false)
    flash('Configurações salvas.')
    router.refresh()
  }

  async function testarConexao() {
    setTestando(true); setErro(''); setOk('')
    try {
      const resp = await fetch('/api/marketplace/shopee/testar-conexao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canalId: canalInicial.id }),
      })
      const data = await resp.json()
      if (!data.ok) { setErro(data.erro ?? 'Erro ao testar conexão'); return }
      flash(`Conectado — loja "${data.shopName}"`)
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao testar conexão')
    } finally {
      setTestando(false)
      router.refresh()
    }
  }

  async function excluir() {
    if (!confirm(`Excluir canal "${canalInicial.nome}"? Todos os anúncios e pedidos serão perdidos.`)) return
    const sb = createClient()
    await sb.from('marketplace_canais').delete().eq('id', canalInicial.id)
    router.push('/dashboard/marketplaces')
    router.refresh()
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <a href="/dashboard/marketplaces" className="hover:text-gray-600">marketplaces</a><span>›</span>
        <span className="text-gray-600 font-medium">{canalInicial.nome}</span>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div className={`w-12 h-12 ${plat.cor} rounded-xl flex items-center justify-center text-2xl`}>{plat.icone}</div>
        <div className="flex-1">
          <h1 className="text-gray-900 text-xl font-semibold">{canalInicial.nome}</h1>
          <p className="text-sm text-gray-400">{plat.label}</p>
        </div>
        <Link href={`/dashboard/marketplaces/${canalInicial.id}/anuncios`}
          className="px-4 py-2 border border-blue-300 text-blue-600 text-sm rounded-lg hover:bg-blue-50 transition-colors">
          Ver anúncios
        </Link>
        <Link href={`/dashboard/marketplaces/${canalInicial.id}/pedidos`}
          className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors">
          Ver pedidos
        </Link>
      </div>

      {ok && <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-lg mb-4">✓ {ok}</div>}
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">{erro}</div>}

      <div className="grid grid-cols-3 gap-6">
        {/* Config */}
        <div className="col-span-2 space-y-5">
          <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">Configurações gerais</h2>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nome do canal</label>
              <input value={form.nome} onChange={e => f('nome', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Markup do canal (%)</label>
                <input type="number" step="0.1" value={form.markup_canal} onChange={e => f('markup_canal', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                <p className="text-xs text-gray-400 mt-1">Aplicado sobre o preço base de cada anúncio</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Seller ID</label>
                <input value={form.seller_id} onChange={e => f('seller_id', e.target.value)}
                  placeholder="ID do vendedor na plataforma"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="flex gap-6 pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.sincronizar_estoque} onChange={e => f('sincronizar_estoque', e.target.checked)}
                  className="w-4 h-4 accent-blue-600" />
                <div>
                  <p className="text-sm text-gray-700">Sincronizar estoque</p>
                  <p className="text-xs text-gray-400">Atualiza estoque no marketplace automaticamente</p>
                </div>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.sincronizar_preco} onChange={e => f('sincronizar_preco', e.target.checked)}
                  className="w-4 h-4 accent-blue-600" />
                <div>
                  <p className="text-sm text-gray-700">Sincronizar preços</p>
                  <p className="text-xs text-gray-400">Atualiza preços no marketplace automaticamente</p>
                </div>
              </label>
            </div>
          </div>

          <div className="border border-blue-100 bg-blue-50 rounded-xl p-5 flex gap-3">
            <span className="text-xl">🔌</span>
            <div>
              <p className="text-sm font-medium text-blue-800 mb-0.5">Credenciais de API</p>
              <p className="text-xs text-blue-700">
                As credenciais de acesso (Partner ID, App Secret, etc.) são configuradas uma única vez pelo administrador do sistema
                e valem para todos os canais desta plataforma.
              </p>
              <a href="/dashboard/configuracoes/integracoes"
                className="inline-flex items-center gap-1 mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium">
                ⚙️ Acessar Configurações → Integrações
              </a>
              {canalInicial.access_token && (
                <div className="mt-3 bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-center gap-2">
                  <span className="text-green-600">✓</span>
                  <div>
                    <p className="text-xs font-medium text-green-700">Token de acesso ativo</p>
                    {canalInicial.token_expira_em && (
                      <p className="text-xs text-green-600">Expira em: {new Date(canalInicial.token_expira_em).toLocaleString('pt-BR')}</p>
                    )}
                  </div>
                </div>
              )}
              {canalInicial.plataforma === 'shopee' && canalInicial.access_token && (
                <button onClick={testarConexao} disabled={testando}
                  className="mt-3 px-3 py-1.5 bg-white border border-blue-300 text-blue-600 text-xs font-medium rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors">
                  {testando ? 'Testando...' : '🔌 Testar conexão'}
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button onClick={excluir}
              className="px-4 py-2 border border-red-300 text-red-600 text-sm rounded-lg hover:bg-red-50 transition-colors">
              Excluir canal
            </button>
            <button onClick={salvar} disabled={salvando}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {salvando ? 'Salvando...' : 'Salvar configurações'}
            </button>
          </div>
        </div>

        {/* Log sync */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700">Log de sincronização</h3>
              <p className="text-xs text-gray-400">Últimas 20 operações</p>
            </div>
            {logs.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-400 text-xs">Nenhuma sincronização registrada.</div>
            ) : (
              <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                {logs.map(log => (
                  <div key={log.id} className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${log.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="text-xs font-medium text-gray-700 capitalize">{log.tipo}</span>
                      <span className={`text-xs ml-auto ${log.status === 'ok' ? 'text-green-600' : 'text-red-500'}`}>{log.status}</span>
                    </div>
                    {log.mensagem && <p className="text-xs text-gray-500 pl-3.5">{log.mensagem}</p>}
                    <p className="text-xs text-gray-400 pl-3.5 mt-0.5">{new Date(log.created_at).toLocaleString('pt-BR')}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
