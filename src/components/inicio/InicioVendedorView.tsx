import Link from 'next/link'
import { saudacao, type AtalhoInicio } from '@/lib/inicio/inicioVendedor'
import type { ResumoAtendimentoML } from '@/lib/mercadolivre/atendimentoRegras'

// O desenho da tela de Início do vendedor. Os dados vêm prontos da página
// (src/app/dashboard/inicio/page.tsx), que decide o que a pessoa pode ver.

const URL_CONVERSAS = '/dashboard/integracoes/whatsapp/conversas'
const URL_PEDIDOS = '/dashboard/pedidos-ecommerce'
const URL_ORCAMENTOS = '/dashboard/orcamentos'
const URL_ATENDIMENTO_ML = '/dashboard/atendimento-ml'
const horaSP = (iso: string) => new Date(iso).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

export type DadosInicio = {
  agora: Date
  nome: string
  nomeEmpresa: string
  atalhos: AtalhoInicio[]
  pedidos: { saemHoje: number; atrasados: number } | null
  conversas: number | null
  orcamentos: { abertos: number; vencemHoje: number } | null
  /** Perguntas e reclamações do Mercado Livre; nulo = sem acesso, sem conta ou o ML não respondeu a tempo. */
  mercadoLivre?: ResumoAtendimentoML | null
}

export default function InicioVendedorView({ agora, nome, nomeEmpresa, atalhos, pedidos, conversas, orcamentos, mercadoLivre }: DadosInicio) {
  const primeiroNome = String(nome ?? '').trim().split(/\s+/)[0] || ''
  const dataExtenso = agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long' })

  const contador: Record<string, number> = {}
  if (pedidos) contador[URL_PEDIDOS] = pedidos.saemHoje + pedidos.atrasados
  if (conversas != null) contador[URL_CONVERSAS] = conversas
  if (orcamentos) contador[URL_ORCAMENTOS] = orcamentos.abertos
  if (mercadoLivre) contador[URL_ATENDIMENTO_ML] = mercadoLivre.perguntas + mercadoLivre.reclamacoes

  const tudoEmDia = (!pedidos || pedidos.saemHoje + pedidos.atrasados === 0)
    && (conversas == null || conversas === 0)
    && (!orcamentos || orcamentos.vencemHoje === 0)
    && (!mercadoLivre || mercadoLivre.perguntas + mercadoLivre.reclamacoes === 0)
  const qtdCartoes = [pedidos, conversas != null ? true : null, orcamentos, mercadoLivre].filter(Boolean).length

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{saudacao(agora)}{primeiroNome ? `, ${primeiroNome}` : ''} 👋</h1>
        <p className="text-sm text-gray-500 mt-0.5 first-letter:uppercase">{dataExtenso}{nomeEmpresa ? ` · ${nomeEmpresa}` : ''}</p>
      </div>

      {/* O que está esperando hoje */}
      {/* Reclamação perto do prazo: o ML decide pelo comprador se ninguém responder. */}
      {mercadoLivre && mercadoLivre.urgentes > 0 && (
        <Link href={URL_ATENDIMENTO_ML} className="block rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 hover:border-red-400">
          ⏰ <strong>{mercadoLivre.urgentes} reclamação(ões) no Mercado Livre vencendo{mercadoLivre.proximoPrazo ? ` — prazo ${horaSP(mercadoLivre.proximoPrazo)}` : ''}.</strong> Sem resposta, o Mercado Livre decide a favor do comprador. Toque para responder.
        </Link>
      )}

      {(pedidos || conversas != null || orcamentos || mercadoLivre) && (
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${qtdCartoes >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
          {pedidos && (
            // Com atraso, abre a lista de abertos (os atrasados vêm no topo);
            // sem atraso, já filtrada no que sai hoje.
            <Link href={pedidos.atrasados ? URL_PEDIDOS : `${URL_PEDIDOS}?janela=hoje`}
              className={`rounded-2xl border p-4 transition-colors ${pedidos.atrasados ? 'bg-red-50 border-red-200 hover:border-red-300' : 'bg-white border-gray-200 hover:border-blue-300'}`}>
              <p className="text-sm text-gray-600">🚚 Despachar hoje</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{pedidos.saemHoje} <span className="text-base font-medium text-gray-500">pedido(s)</span></p>
              {pedidos.atrasados > 0
                ? <p className="text-sm font-semibold text-red-600 mt-0.5">⚠ {pedidos.atrasados} atrasado(s)</p>
                : <p className="text-xs text-gray-400 mt-0.5">nenhum atrasado</p>}
            </Link>
          )}
          {conversas != null && (
            <Link href={`${URL_CONVERSAS}?f=aguardando`}
              className={`rounded-2xl border p-4 transition-colors ${conversas ? 'bg-emerald-50 border-emerald-200 hover:border-emerald-300' : 'bg-white border-gray-200 hover:border-blue-300'}`}>
              <p className="text-sm text-gray-600">💬 Clientes esperando resposta</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{conversas} <span className="text-base font-medium text-gray-500">no WhatsApp</span></p>
              <p className="text-xs text-gray-400 mt-0.5">{conversas ? 'toque para atender' : 'ninguém esperando'}</p>
            </Link>
          )}
          {orcamentos && (
            <Link href={URL_ORCAMENTOS}
              className={`rounded-2xl border p-4 transition-colors ${orcamentos.vencemHoje ? 'bg-amber-50 border-amber-200 hover:border-amber-300' : 'bg-white border-gray-200 hover:border-blue-300'}`}>
              <p className="text-sm text-gray-600">📋 Orçamentos em aberto</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{orcamentos.abertos}</p>
              {orcamentos.vencemHoje > 0
                ? <p className="text-sm font-semibold text-amber-700 mt-0.5">{orcamentos.vencemHoje} vence(m) hoje</p>
                : <p className="text-xs text-gray-400 mt-0.5">nenhum vence hoje</p>}
            </Link>
          )}
          {mercadoLivre && (
            <Link href={URL_ATENDIMENTO_ML}
              className={`rounded-2xl border p-4 transition-colors ${mercadoLivre.urgentes ? 'bg-red-50 border-red-200 hover:border-red-300' : mercadoLivre.perguntas + mercadoLivre.reclamacoes ? 'bg-yellow-50 border-yellow-200 hover:border-yellow-300' : 'bg-white border-gray-200 hover:border-blue-300'}`}>
              <p className="text-sm text-gray-600">🙋 Mercado Livre</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{mercadoLivre.perguntas} <span className="text-base font-medium text-gray-500">pergunta(s)</span></p>
              {mercadoLivre.reclamacoes > 0
                ? <p className={`text-sm font-semibold mt-0.5 ${mercadoLivre.urgentes ? 'text-red-600' : 'text-amber-700'}`}>
                    {mercadoLivre.reclamacoes} reclamação(ões){mercadoLivre.urgentes ? ` · ${mercadoLivre.urgentes} vencendo` : ''}
                  </p>
                : <p className="text-xs text-gray-400 mt-0.5">nenhuma reclamação</p>}
            </Link>
          )}
        </div>
      )}
      {tudoEmDia && (pedidos || conversas != null || orcamentos || mercadoLivre) && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2">✓ Tudo em dia por aqui.</p>
      )}

      {/* Botões grandes */}
      {atalhos.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">O que você quer fazer?</p>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {atalhos.map(a => (
              <Link key={a.href} href={a.href}
                className="relative bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 flex flex-col items-center text-center gap-2 hover:border-blue-400 hover:shadow-md transition min-h-[150px] justify-center">
                {contador[a.href] ? (
                  <span className="absolute top-2.5 right-2.5 min-w-[1.6rem] h-[1.6rem] px-1.5 rounded-full bg-red-500 text-white text-sm font-bold flex items-center justify-center">
                    {contador[a.href] > 99 ? '99+' : contador[a.href]}
                  </span>
                ) : null}
                <span className={`w-16 h-16 sm:w-20 sm:h-20 rounded-2xl ${a.cor} flex items-center justify-center text-4xl sm:text-5xl`}>{a.icone}</span>
                <span className="text-base sm:text-lg font-semibold text-gray-900 leading-tight">{a.titulo}</span>
                <span className="text-xs text-gray-500 hidden sm:block">{a.descricao}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center">
          <p className="text-3xl mb-2">🔒</p>
          <p className="text-sm text-gray-700">Nenhuma tela de vendas está liberada para o seu usuário ainda.</p>
          <p className="text-xs text-gray-500 mt-1">Peça ao administrador para liberar em Configurações → Usuários → Permissões.</p>
        </div>
      )}
    </div>
  )
}
