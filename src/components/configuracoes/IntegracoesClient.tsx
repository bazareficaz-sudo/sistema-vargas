'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const PLATAFORMAS_CONFIG = [
  {
    id: 'shopee',
    label: 'Shopee',
    emoji: '🧡',
    cor: 'border-orange-200 bg-orange-50',
    descricao: 'Credenciais do seu App no Shopee Open Platform. Válidas para todas as lojas conectadas.',
    campos: [
      { key: 'partner_id', label: 'Partner ID', placeholder: 'Ex: 1234567', tipo: 'text', dica: 'Encontre em: open.shopee.com → Meu App → Partner ID' },
      { key: 'partner_key', label: 'Partner Key', placeholder: 'Cole a chave aqui', tipo: 'password', dica: 'Encontre em: open.shopee.com → Meu App → Partner Key' },
    ],
    link: 'https://open.shopee.com',
    linkLabel: 'Abrir Shopee Open Platform',
  },
  {
    id: 'mercadolivre',
    label: 'Mercado Livre',
    emoji: '🟡',
    cor: 'border-yellow-200 bg-yellow-50',
    descricao: 'Credenciais do App criado no Mercado Livre Developers. Únicas para o sistema.',
    campos: [
      { key: 'app_id', label: 'App ID (Client ID)', placeholder: 'Ex: 1234567890', tipo: 'text', dica: 'Encontre em: developers.mercadolivre.com.br → Meus Apps' },
      { key: 'app_secret', label: 'Client Secret', placeholder: 'Cole a chave secreta aqui', tipo: 'password', dica: 'Gerado junto com o App ID no painel de desenvolvedores' },
    ],
    link: 'https://developers.mercadolivre.com.br',
    linkLabel: 'Abrir ML Developers',
  },
  {
    id: 'nuvemshop',
    label: 'Nuvemshop',
    emoji: '🛍️',
    cor: 'border-sky-200 bg-sky-50',
    descricao: 'Credenciais do aplicativo criado no Portal de Parceiros da Nuvemshop. Únicas para o sistema.',
    campos: [
      { key: 'app_id', label: 'ID do aplicativo (Client ID)', placeholder: 'Ex: 12345', tipo: 'text', dica: 'Encontre em: partners.nuvemshop.com.br → Seus aplicativos' },
      { key: 'app_secret', label: 'Client Secret', placeholder: 'Cole a chave secreta aqui', tipo: 'password', dica: 'Gerado junto com o ID do aplicativo. Também é a chave que assina os webhooks.' },
    ],
    link: 'https://partners.nuvemshop.com.br',
    linkLabel: 'Abrir Portal de Parceiros',
  },
  {
    id: 'amazon',
    label: 'Amazon',
    emoji: '📦',
    cor: 'border-amber-200 bg-amber-50',
    descricao: 'Credenciais MWS / SP-API da Amazon. Configure uma vez para todas as contas.',
    campos: [
      { key: 'app_id', label: 'LWA Client ID', placeholder: 'amzn1.application-oa2-client...', tipo: 'text', dica: 'Encontre em: sellercentral.amazon.com.br → Apps e Serviços → Desenvolver apps' },
      { key: 'app_secret', label: 'LWA Client Secret', placeholder: 'Cole aqui', tipo: 'password', dica: 'Gerado junto com o Client ID no Seller Central' },
    ],
    link: 'https://sellercentral.amazon.com.br',
    linkLabel: 'Abrir Amazon Seller Central',
  },
  {
    id: 'magalu',
    label: 'Magazine Luiza',
    emoji: '🛍️',
    cor: 'border-blue-200 bg-blue-50',
    descricao: 'Credenciais de integração do Magalu Marketplace.',
    campos: [
      { key: 'app_id', label: 'Client ID', placeholder: 'Cole aqui', tipo: 'text', dica: 'Fornecido pelo time de integrações do Magalu' },
      { key: 'app_secret', label: 'Client Secret', placeholder: 'Cole aqui', tipo: 'password', dica: 'Fornecido junto com o Client ID' },
    ],
    link: 'https://marketplace.magalu.com.br',
    linkLabel: 'Abrir Portal Magalu',
  },
]

type IntRow = { id: string; plataforma: string; partner_id?: string; partner_key?: string; app_id?: string; app_secret?: string; ativo: boolean }

export default function IntegracoesClient({ integracoes: inicial }: { integracoes: IntRow[] }) {
  const [integracoes, setIntegracoes] = useState<IntRow[]>(inicial)
  const [editando, setEditando] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [ok, setOk] = useState<string | null>(null)
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({})
  const [mostrando, setMostrando] = useState<Record<string, boolean>>({})

  function getIntegracao(platId: string) {
    return integracoes.find(i => i.plataforma === platId)
  }

  function iniciarEdicao(platId: string) {
    const int = getIntegracao(platId)
    setForms(prev => ({
      ...prev,
      [platId]: {
        partner_id: int?.partner_id ?? '',
        partner_key: int?.partner_key ?? '',
        app_id: int?.app_id ?? '',
        app_secret: int?.app_secret ?? '',
      }
    }))
    setEditando(platId)
  }

  function fv(platId: string, key: string, val: string) {
    setForms(prev => ({ ...prev, [platId]: { ...prev[platId], [key]: val } }))
  }

  async function salvar(platId: string) {
    setSalvando(true)
    const sb = createClient()
    const dados = {
      plataforma: platId,
      partner_id: forms[platId]?.partner_id || null,
      partner_key: forms[platId]?.partner_key || null,
      app_id: forms[platId]?.app_id || null,
      app_secret: forms[platId]?.app_secret || null,
      ativo: true,
      updated_at: new Date().toISOString(),
    }
    const existing = getIntegracao(platId)
    let result
    if (existing) {
      result = await sb.from('sistema_integracoes').update(dados).eq('id', existing.id).select().single()
    } else {
      result = await sb.from('sistema_integracoes').insert(dados).select().single()
    }
    setSalvando(false)
    if (result.error) { alert(result.error.message); return }
    setIntegracoes(prev => {
      const sem = prev.filter(i => i.plataforma !== platId)
      return [...sem, result.data]
    })
    setEditando(null)
    setOk(platId)
    setTimeout(() => setOk(null), 3000)
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <span>configurações</span><span>›</span>
        <span className="text-gray-600 font-medium">integrações</span>
      </div>

      <div className="mb-6">
        <h1 className="text-gray-900 text-xl font-semibold">Integrações com Marketplaces</h1>
        <p className="text-gray-500 text-sm mt-1">
          Credenciais do sistema — configuradas <strong>uma única vez</strong> e válidas para todos os canais de venda cadastrados.
        </p>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-6 flex gap-3">
        <span className="text-lg">⚠️</span>
        <p className="text-sm text-amber-800">
          Estas são credenciais de <strong>administrador do sistema</strong>. Não compartilhe com assinantes.
          Cada plataforma exige um App/Parceiro criado uma única vez — depois disso, qualquer número de lojas pode ser conectado.
        </p>
      </div>

      <div className="space-y-4">
        {PLATAFORMAS_CONFIG.map(plat => {
          const int = getIntegracao(plat.id)
          const configurada = !!(int?.partner_id || int?.partner_key || int?.app_id || int?.app_secret)
          const emEdicao = editando === plat.id
          const form = forms[plat.id] ?? {}

          return (
            <div key={plat.id} className={`border rounded-xl overflow-hidden ${plat.cor}`}>
              {/* Cabeçalho da plataforma */}
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{plat.emoji}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900 text-sm">{plat.label}</p>
                      {configurada && !emEdicao && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ Configurado</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">{plat.descricao}</p>
                  </div>
                </div>
                {!emEdicao && (
                  <button onClick={() => iniciarEdicao(plat.id)}
                    className="px-3 py-1.5 text-xs border border-gray-300 bg-white text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
                    {configurada ? 'Editar' : 'Configurar'}
                  </button>
                )}
                {ok === plat.id && (
                  <span className="text-xs text-green-600 font-medium">✓ Salvo!</span>
                )}
              </div>

              {/* Formulário */}
              {emEdicao && (
                <div className="bg-white border-t border-gray-100 px-4 py-4 space-y-4">
                  {plat.link && (
                    <a href={plat.link} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium">
                      🔗 {plat.linkLabel}
                    </a>
                  )}

                  {plat.campos.map(campo => (
                    <div key={campo.key}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{campo.label}</label>
                      <div className="relative">
                        <input
                          type={campo.tipo === 'password' && mostrando[`${plat.id}_${campo.key}`] ? 'text' : campo.tipo}
                          value={form[campo.key] ?? ''}
                          onChange={e => fv(plat.id, campo.key, e.target.value)}
                          placeholder={campo.placeholder}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 font-mono pr-10"
                        />
                        {campo.tipo === 'password' && (
                          <button type="button"
                            onClick={() => setMostrando(prev => ({ ...prev, [`${plat.id}_${campo.key}`]: !prev[`${plat.id}_${campo.key}`] }))}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">
                            {mostrando[`${plat.id}_${campo.key}`] ? '🙈' : '👁'}
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-1">💡 {campo.dica}</p>
                    </div>
                  ))}

                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setEditando(null)}
                      className="px-4 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
                      Cancelar
                    </button>
                    <button onClick={() => salvar(plat.id)} disabled={salvando}
                      className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors">
                      {salvando ? 'Salvando...' : '✓ Salvar credenciais'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
