'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { botao } from '@/components/ui/botao'

// Criação da loja para uma empresa que ainda não tem.
//
// Fica no painel, e não numa migração, porque é isto que torna a Loja Online
// um recurso do produto em vez de uma configuração feita à mão para uma
// empresa. Quando o SaaS abrir, o cliente novo passa por esta mesma tela.
//
// A loja NASCE FECHADA: inativa, em manutenção e invisível para o Google.
// Ninguém liga uma vitrine vazia para o mundo sem querer.

export default function CriarLoja() {
  const router = useRouter()
  const [nome, setNome] = useState('')
  const [subdominio, setSubdominio] = useState('')
  const [criando, setCriando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function sugerirSubdominio(v: string) {
    return v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 63)
  }

  async function criar() {
    setCriando(true)
    setErro(null)
    try {
      const r = await fetch('/api/loja-admin/criar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nome.trim(), subdominio: subdominio.trim() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.erro ?? 'Não foi possível criar')
      router.refresh()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar')
    } finally {
      setCriando(false)
    }
  }

  const valido = nome.trim().length >= 2 && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdominio)

  return (
    <div className="mt-4 max-w-lg rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold text-gray-900">Esta empresa ainda não tem loja online</h2>
      <p className="mt-1 text-sm text-gray-500">
        A loja entra como mais um canal de venda, ao lado do PDV e dos marketplaces.
        Ela nasce fechada — nada fica público até você decidir.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor="nome-loja" className="block text-sm font-medium text-gray-700">Nome da loja</label>
          <input
            id="nome-loja"
            value={nome}
            onChange={e => {
              setNome(e.target.value)
              // Sugere o endereço enquanto o operador não o edita à mão.
              if (!subdominio || subdominio === sugerirSubdominio(nome)) {
                setSubdominio(sugerirSubdominio(e.target.value))
              }
            }}
            maxLength={120}
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label htmlFor="sub-loja" className="block text-sm font-medium text-gray-700">Endereço</label>
          <div className="mt-1 flex items-center">
            <input
              id="sub-loja"
              value={subdominio}
              onChange={e => setSubdominio(sugerirSubdominio(e.target.value))}
              maxLength={63}
              className="h-10 min-w-0 flex-1 rounded-l-lg border border-gray-300 px-3 font-mono text-sm outline-none focus:border-blue-500"
            />
            <span className="rounded-r-lg border border-l-0 border-gray-300 bg-gray-50 px-2 py-2 text-sm text-gray-500">
              .seu-domínio
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Trocar depois de divulgar quebra os links já compartilhados — vale escolher com calma.
          </p>
        </div>
      </div>

      {erro && <p className="mt-3 text-sm text-red-700">{erro}</p>}

      <button onClick={criar} disabled={!valido || criando} className={botao('primario', 'md', 'mt-4')}>
        {criando ? 'Criando…' : 'Criar loja'}
      </button>
    </div>
  )
}
