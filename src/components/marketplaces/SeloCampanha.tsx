'use client'

import { textoDoSelo, explicarSelo, type SeloCampanha } from '@/lib/marketplace/seloCampanha'

// O selo de campanha, uma vez só, para as duas telas que precisam dele.
//
// Listagem de anúncios e precificação fazem a MESMA pergunta ("este item está
// comprometido com uma campanha?") e precisam da mesma resposta. Duas cópias
// divergiriam na primeira mudança de regra — e divergir aqui significa a
// mesma tesoura aparecer em campanha numa tela e livre na outra.

const CORES: Record<string, string> = {
  valendo: 'bg-blue-50 text-blue-700 border-blue-200',
  urgente: 'bg-amber-50 text-amber-800 border-amber-300',
  programada: 'bg-violet-50 text-violet-700 border-violet-200',
  expirada: 'bg-gray-100 text-gray-600 border-gray-300',
}

function cor(s: SeloCampanha) {
  if (s.estado === 'programada') return CORES.programada
  if (s.estado === 'expirada') return CORES.expirada
  // Perto do fim muda de cor: um desconto que acaba amanhã é decisão de hoje.
  return s.proximidade === 'termina_hoje' || s.proximidade === 'termina_em_3_dias'
    ? CORES.urgente : CORES.valendo
}

export default function SeloCampanhaChip({ selos, mostrarNome = true, className = '' }: {
  selos: SeloCampanha[] | null | undefined
  /** Na listagem cabe o nome da campanha; em coluna estreita, não. */
  mostrarNome?: boolean
  className?: string
}) {
  if (!selos || selos.length === 0) return null
  const s = selos[0]
  const outros = selos.length - 1

  return (
    <span className={`inline-flex items-baseline gap-1 flex-wrap ${className}`}>
      <span
        className={`inline-flex items-baseline gap-1 px-1.5 py-px rounded border text-[10px] ${cor(s)}`}
        title={explicarSelo(s)}
      >
        <span>🏷</span>
        {mostrarNome && <span className="font-medium truncate max-w-[9rem]">{s.nome}</span>}
        <span>{textoDoSelo(s)}</span>
        {/* O espelho é manual: sem cron, um selo velho pode descrever uma
            campanha da qual o item já saiu. O aviso fica no selo, não numa
            nota de rodapé que ninguém lê. */}
        {s.espelhoVelho && <span title="Leitura de mais de um dia atrás — sincronize as promoções.">⏳</span>}
      </span>
      {outros > 0 && (
        <span className="text-[10px] text-gray-500" title={selos.slice(1).map(explicarSelo).join('\n\n')}>
          +{outros}
        </span>
      )}
      {/* Preço da campanha ao lado do preço de venda: é o número que decide se
          vale entrar, e procurá-lo em outra tela é o que faz ninguém olhar. */}
      {s.precoDe != null && (
        <span className="text-[10px] text-gray-500">
          {s.precoPorVariacao
            ? `${brl(s.precoDe)}–${brl(s.precoAte!)}`
            : brl(s.precoDe)}
        </span>
      )}
    </span>
  )
}

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
