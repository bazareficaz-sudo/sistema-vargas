'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { botao } from '@/components/ui/botao'

// Assistente de domínio próprio: anexar, guiar o DNS e ativar — tudo pelo
// painel, sem precisar de ninguém rodando `vercel domains add` por fora.
//
// Três passos, e cada um só aparece quando o anterior terminou:
//   1. Anexar o domínio ao projeto (rota `dominio/adicionar`) — devolve os
//      registros de DNS que a PRÓPRIA Vercel recomenda para aquele domínio.
//   2. A pessoa configura o DNS no provedor dela (instruções abaixo, por
//      provedor) e clica "Verificar" (rota `dominio/status`, sem efeito
//      no banco — só lê a Vercel).
//   3. Só com o DNS certo é que "Ativar" aparece. Ativar grava
//      `loja_config.dominio_proprio` pela MESMA rota das outras abas
//      (`/api/loja-admin/config`) — nenhuma rota nova para isso.

type StatusResposta = {
  dominio: string
  apex: boolean
  apexName: string
  misconfigured: boolean
  verificadoNoProjeto: boolean
  recommendedIPv4: string[]
  recommendedCNAME: string[]
  desafios: { type: string; domain: string; value: string; reason?: string }[]
}

type Provedor = 'registrobr' | 'cloudflare'

export default function DominioProprioClient({ lojaId, dominioAtivo }: {
  lojaId: string
  dominioAtivo: string | null
}) {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [carregando, setCarregando] = useState<'adicionar' | 'verificar' | 'ativar' | 'remover' | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusResposta | null>(null)
  const [provedor, setProvedor] = useState<Provedor>('registrobr')

  const pronto = !!status && status.verificadoNoProjeto && !status.misconfigured

  async function chamar<T>(caminho: string, opcoes?: RequestInit): Promise<T> {
    const r = await fetch(caminho, opcoes)
    const dados = await r.json()
    if (!r.ok) throw new Error(dados.erro ?? 'Não foi possível completar a operação')
    return dados as T
  }

  async function adicionar() {
    setErro(null)
    setCarregando('adicionar')
    try {
      const dados = await chamar<StatusResposta>('/api/loja-admin/dominio/adicionar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lojaId, dominio: input }),
      })
      setStatus(dados)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível anexar o domínio')
    } finally {
      setCarregando(null)
    }
  }

  async function verificar() {
    if (!status) return
    setErro(null)
    setCarregando('verificar')
    try {
      const dados = await chamar<StatusResposta>(
        `/api/loja-admin/dominio/status?lojaId=${lojaId}&dominio=${encodeURIComponent(status.dominio)}`,
      )
      setStatus(dados)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível checar o domínio')
    } finally {
      setCarregando(null)
    }
  }

  async function ativar() {
    if (!status) return
    setErro(null)
    setCarregando('ativar')
    try {
      await chamar('/api/loja-admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lojaId, campos: { dominio_proprio: status.dominio } }),
      })
      router.refresh()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ativar o domínio')
    } finally {
      setCarregando(null)
    }
  }

  async function remover(dominio: string) {
    setErro(null)
    setCarregando('remover')
    try {
      await chamar('/api/loja-admin/dominio/remover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lojaId, dominio }),
      })
      setStatus(null)
      setInput('')
      router.refresh()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível remover o domínio')
    } finally {
      setCarregando(null)
    }
  }

  // ── Já tem um domínio próprio ativo: mostra e oferece trocar ──────────────
  if (dominioAtivo && !status) {
    return (
      <section className="rounded-xl border border-green-200 bg-green-50 p-4">
        <p className="text-sm font-medium text-green-900">
          Domínio próprio ativo: <span className="font-mono">{dominioAtivo}</span>
        </p>
        <p className="mt-1 text-sm text-green-800">
          A loja responde por este endereço além do subdomínio.
        </p>
        {erro && <p className="mt-2 text-sm text-red-700">{erro}</p>}
        <button
          onClick={() => remover(dominioAtivo)}
          disabled={carregando !== null}
          className={`${botao('perigo', 'sm')} mt-3`}
        >
          {carregando === 'remover' ? 'Removendo…' : 'Remover e trocar de domínio'}
        </button>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 p-4">
        <h2 className="font-semibold text-gray-900">Domínio próprio</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Três passos: anexar o domínio, apontar o DNS no provedor onde ele foi
          registrado, e ativar. Tudo aqui — nenhum comando por fora.
        </p>
      </div>

      <div className="space-y-4 p-4">
        {/* ── Passo 1 ─────────────────────────────────────────────────── */}
        {!status && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="minhaloja.com.br ou www.minhaloja.com.br"
              className="h-10 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-sm font-mono outline-none focus:border-blue-500"
            />
            <button
              onClick={adicionar}
              disabled={!input.trim() || carregando !== null}
              className={botao('primario')}
            >
              {carregando === 'adicionar' ? 'Anexando…' : '1. Anexar domínio'}
            </button>
          </div>
        )}

        {erro && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{erro}</p>
        )}

        {/* ── Passo 2: instruções + verificar ─────────────────────────── */}
        {status && (
          <div className="space-y-4">
            <div className={`rounded-lg border p-3 text-sm ${
              pronto ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}>
              <p className="font-medium">
                {pronto
                  ? `Tudo certo com ${status.dominio}.`
                  : `Aguardando o DNS de ${status.dominio} apontar para a Vercel.`}
              </p>
              {!pronto && (
                <p className="mt-1">
                  {status.misconfigured
                    ? 'O registro de DNS ainda não foi encontrado, ou aponta para outro lugar — siga as instruções abaixo no provedor onde este domínio foi registrado.'
                    : !status.verificadoNoProjeto
                      ? 'O DNS já aponta certo, mas a Vercel ainda não confirmou a posse deste domínio — normalmente resolve sozinho em minutos.'
                      : ''}
                </p>
              )}
            </div>

            {!pronto && (
              <div>
                <div className="flex gap-2 border-b border-gray-200">
                  {(['registrobr', 'cloudflare'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setProvedor(p)}
                      className={`px-3 py-2 text-sm font-medium ${
                        provedor === p
                          ? 'border-b-2 border-blue-600 text-blue-700'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {p === 'registrobr' ? 'Registro.br' : 'Cloudflare'}
                    </button>
                  ))}
                </div>

                <div className="pt-3">
                  <InstrucoesProvedor provedor={provedor} status={status} />
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button onClick={verificar} disabled={carregando !== null} className={botao('secundario')}>
                {carregando === 'verificar' ? 'Verificando…' : '2. Verificar configuração'}
              </button>
              {pronto && (
                <button onClick={ativar} disabled={carregando !== null} className={botao('primario')}>
                  {carregando === 'ativar' ? 'Ativando…' : '3. Ativar para esta loja'}
                </button>
              )}
              <button
                onClick={() => remover(status.dominio)}
                disabled={carregando !== null}
                className={botao('sutil', 'sm')}
              >
                Cancelar e tentar outro domínio
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function InstrucoesProvedor({ provedor, status }: { provedor: Provedor; status: StatusResposta }) {
  const ip = status.recommendedIPv4[0] ?? '76.76.21.21'
  const cname = status.recommendedCNAME[0] ?? 'cname.vercel-dns.com'
  // "Nome"/"Name" do registro: raiz é '@' (ou em branco); subdomínio é a
  // primeira parte antes do domínio raiz (ex: "www" de "www.exemplo.com.br").
  const nomeRegistro = status.apex ? '@' : status.dominio.slice(0, -(status.apexName.length + 1))
  const tipo = status.apex ? 'A' : 'CNAME'
  const valor = status.apex ? ip : cname

  const Registro = () => (
    <div className="my-2 grid grid-cols-3 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 font-mono text-xs">
      <div><span className="block text-gray-400">Tipo</span>{tipo}</div>
      <div><span className="block text-gray-400">Nome</span>{nomeRegistro}</div>
      <div className="truncate"><span className="block text-gray-400">Valor</span>{valor}</div>
    </div>
  )

  if (provedor === 'registrobr') {
    return (
      <div className="text-sm text-gray-700">
        <ol className="list-inside list-decimal space-y-1">
          <li>Entre em <span className="font-mono">registro.br</span> → <em>Login</em> → <em>Meus domínios</em>.</li>
          <li>Clique no domínio <span className="font-mono">{status.apexName}</span> → aba <em>DNS</em>.</li>
          <li>Se o DNS deste domínio for o do próprio Registro.br (não um servidor externo), adicione um registro:</li>
        </ol>
        <Registro />
        <p className="text-xs text-gray-500">
          O Registro.br não aceita <span className="font-mono">*</span> no campo Nome — por isso o registro
          precisa ser exatamente {status.apex ? 'a raiz (@)' : `"${nomeRegistro}"`}, não um curinga.
          Salvar e aguardar propagação (costuma ser rápido, pode levar algumas horas).
        </p>
      </div>
    )
  }

  return (
    <div className="text-sm text-gray-700">
      <ol className="list-inside list-decimal space-y-1">
        <li>Entre em <span className="font-mono">dash.cloudflare.com</span> → selecione o domínio <span className="font-mono">{status.apexName}</span>.</li>
        <li>Aba <em>DNS</em> → <em>Records</em> → <em>Add record</em>:</li>
      </ol>
      <Registro />
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
        Importante: deixe a nuvem de proxy <strong>cinza (DNS only)</strong>, não laranja. Com o proxy da
        Cloudflare ligado neste registro, a Vercel não consegue emitir o certificado e o domínio nunca
        sai de &quot;aguardando&quot;.
      </p>
    </div>
  )
}
