'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  descreverMinutos, minutosValidos, INATIVIDADE_MIN_MINIMO, INATIVIDADE_MIN_MAXIMO, type ConfigSessao,
} from '@/lib/auth/configSessao'

const ATALHOS_MIN = [15, 30, 60, 120, 240]

function Interruptor({ ligado, onClick, desabilitado }: { ligado: boolean; onClick: () => void; desabilitado: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={desabilitado}
      aria-pressed={ligado}
      className={`shrink-0 w-11 h-6 rounded-full transition-colors relative disabled:cursor-not-allowed ${ligado ? 'bg-blue-600' : 'bg-slate-300'}`}>
      <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${ligado ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

export default function SessaoConfig({ configInicial, podeEditar }: {
  configInicial: ConfigSessao
  podeEditar: boolean
}) {
  const router = useRouter()

  const [inatividadeAtiva, setInatividadeAtiva] = useState(configInicial.inatividadeAtiva)
  const [minutos, setMinutos] = useState(String(configInicial.inatividadeMin))
  const [viradaDiaAtiva, setViradaDiaAtiva] = useState(configInicial.viradaDiaAtiva)
  const [salvando, setSalvando] = useState(false)
  const [ok, setOk] = useState('')
  const [erro, setErro] = useState('')

  const minNum = Number(minutos)
  const minValido = minutosValidos(minNum)
  const incompleta = inatividadeAtiva && !minValido

  function mudou() { setOk(''); setErro('') }

  async function salvar() {
    if (incompleta) {
      setErro(`Informe um tempo inteiro entre ${INATIVIDADE_MIN_MINIMO} e ${INATIVIDADE_MIN_MAXIMO} minutos.`)
      return
    }
    setSalvando(true); mudou()
    try {
      const d = await fetch('/api/configuracoes/sessao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inatividadeAtiva, inatividadeMin: minNum, viradaDiaAtiva }),
      }).then(r => r.json())
      if (!d.ok) { setErro(d.erro ?? 'Não foi possível salvar.'); return }
      setOk('Configuração salva. Vale para todos os usuários desta empresa a partir da próxima tela que abrirem.')
      // O SessaoVigia recebe a regra pelo layout do dashboard — refresh faz
      // esta própria aba já passar a usar o valor novo.
      router.refresh()
    } catch {
      setErro('Não foi possível salvar — verifique a conexão.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Sessão e Segurança</h1>
        <p className="text-slate-500 text-sm mt-1">
          Quando o sistema deve encerrar sozinho a sessão de quem está logado no painel. Vale para
          todos os usuários desta empresa. O PDV tem sessão própria e não é afetado.
        </p>
      </div>

      {!podeEditar && (
        <p className="text-amber-800 text-sm bg-amber-50 border border-amber-200 rounded-lg p-3">
          Você pode ver esta configuração, mas só quem administra as configurações da empresa pode alterá-la.
        </p>
      )}

      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-slate-800 font-medium">Sair por inatividade</h2>
            <p className="text-slate-500 text-sm mt-1">
              Encerra a sessão depois de um tempo sem nenhum uso — mouse, teclado, toque ou
              rolagem. Usar o sistema em qualquer aba conta como uso para todas as abas do
              mesmo navegador.
            </p>
          </div>
          <Interruptor ligado={inatividadeAtiva} desabilitado={!podeEditar}
            onClick={() => { setInatividadeAtiva(v => !v); mudou() }} />
        </div>

        <div className={inatividadeAtiva ? '' : 'opacity-40 pointer-events-none'}>
          <label className="block text-sm text-slate-600 mb-1">Encerrar depois de</label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-32">
              <input type="number" step="1" min={INATIVIDADE_MIN_MINIMO} max={INATIVIDADE_MIN_MAXIMO}
                value={minutos} disabled={!podeEditar}
                onChange={e => { setMinutos(e.target.value); mudou() }}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-blue-400 pr-10 disabled:cursor-not-allowed" />
              <span className="absolute right-3 top-2 text-xs text-slate-400">min</span>
            </div>
            {ATALHOS_MIN.map(m => (
              <button key={m} type="button" disabled={!podeEditar}
                onClick={() => { setMinutos(String(m)); mudou() }}
                className={`px-2.5 py-1.5 rounded-lg text-xs border disabled:cursor-not-allowed ${minNum === m
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                {descreverMinutos(m)}
              </button>
            ))}
          </div>
          <p className={`text-xs mt-2 ${incompleta ? 'text-red-600' : 'text-slate-400'}`}>
            {minValido
              ? <>Sem uso por <strong>{descreverMinutos(minNum)}</strong>, a pessoa volta para a tela de login.</>
              : <>Use um número inteiro entre {INATIVIDADE_MIN_MINIMO} minutos e {descreverMinutos(INATIVIDADE_MIN_MAXIMO)}.</>}
          </p>
        </div>

        {!inatividadeAtiva && (
          <p className="text-slate-500 text-xs bg-slate-50 border border-slate-100 rounded-lg p-3">
            Com esta regra desligada, uma aba esquecida aberta continua logada enquanto o navegador
            estiver aberto. Em computador compartilhado ou de balcão, isso deixa o sistema
            acessível a quem passar por ele.
          </p>
        )}
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-slate-800 font-medium">Sair na virada do dia</h2>
            <p className="text-slate-500 text-sm mt-1">
              Exige novo login a cada dia: uma sessão aberta ontem — aba esquecida ligada de
              madrugada, ou navegador reaberto no dia seguinte — é encerrada, mesmo sem ter
              atingido o tempo de inatividade.
            </p>
          </div>
          <Interruptor ligado={viradaDiaAtiva} desabilitado={!podeEditar}
            onClick={() => { setViradaDiaAtiva(v => !v); mudou() }} />
        </div>
      </div>

      {ok && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-3 py-2 text-sm">{ok}</div>}
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{erro}</div>}

      {podeEditar && (
        <div className="flex justify-end">
          <button onClick={salvar} disabled={salvando || incompleta}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm disabled:opacity-50">
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      )}
    </div>
  )
}
