'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// ONDE ESTE PRODUTO ESTA, dentro do proprio cadastro.
//
// Ate 02/09/2026 nao dava: o modal de produto tinha sete abas e nenhuma de
// enderecamento. Para enderecar um produto que se estava editando era preciso
// sair da tela, abrir Enderecamento e procurar o produto de novo.
//
// O SERVIDOR JA ESTAVA PRONTO. `GET /api/enderecamento/produtos?produtoId=`
// responde onde o produto esta, e `POST .../produtos/ajustar` grava produto +
// endereco + quantidade — e a mesma rota que a tela "Produtos sem endereco"
// usa. Nada de logica nova de estoque aqui: uma segunda maneira de escrever
// quantidade em endereco divergiria da primeira no primeiro conserto.

type Vinculo = {
  id: string
  endereco_id: string
  deposito_id: string
  quantidade: number
  quantidade_reservada: number
  papel: string | null
  ultima_movimentacao: string | null
  foto_url: string | null
  foto_atualizada_em: string | null
  enderecos?: { codigo_legivel: string; tipo: string | null; status: string | null; descricao: string | null } | null
}

type EnderecoCandidato = { id: string; codigo_legivel: string; tipo?: string | null; deposito_id?: string }

const dataCurta = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR') : null

export default function AbaEnderecos({ produtoId, empresaId }: { produtoId: string; empresaId: string }) {
  const sb = createClient()
  const [vinculos, setVinculos] = useState<Vinculo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  // Endereçar
  const [busca, setBusca] = useState('')
  const [candidatos, setCandidatos] = useState<EnderecoCandidato[]>([])
  const [escolhido, setEscolhido] = useState<EnderecoCandidato | null>(null)
  const [quantidade, setQuantidade] = useState('')
  const [salvando, setSalvando] = useState(false)

  // Foto
  const [enviandoFoto, setEnviandoFoto] = useState<string | null>(null)
  const inputFoto = useRef<HTMLInputElement>(null)
  const [alvoFoto, setAlvoFoto] = useState<Vinculo | null>(null)

  // NENHUM setState ANTES DO PRIMEIRO await.
  //
  // `setCarregando(true)` no topo, chamado de dentro de um efeito, dispara
  // uma renderização em cascata — é o que a regra `set-state-in-effect`
  // acusa. `carregando` já nasce true, então a carga inicial não precisa
  // avisar que começou: ela só precisa avisar que terminou.
  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/enderecamento/produtos?produtoId=${produtoId}`).then(x => x.json())
      if (!r?.ok) { setErro(r?.erro ?? 'Não foi possível ler os endereços.'); return }
      setErro('')
      setVinculos(r.linhas ?? [])
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao consultar endereços')
    } finally {
      setCarregando(false)
    }
  }, [produtoId])

  useEffect(() => { void carregar() }, [carregar])

  // Busca de endereços com espera: a lista roda a cada tecla e o depósito tem
  // milhares de posições.
  useEffect(() => {
    // Sem termo não há o que buscar. Quem LIMPA a lista é o `onChange` do
    // campo — limpar aqui seria setState síncrono dentro do efeito.
    if (!busca.trim()) return
    let vivo = true
    const t = setTimeout(async () => {
      const r = await fetch(`/api/enderecamento/enderecos?status=ativo&busca=${encodeURIComponent(busca)}`)
        .then(x => x.json()).catch(() => null)
      if (vivo) setCandidatos(r?.ok ? (r.enderecos ?? []).slice(0, 8) : [])
    }, 300)
    return () => { vivo = false; clearTimeout(t) }
  }, [busca])

  async function enderecar() {
    if (!escolhido || !quantidade) return
    setSalvando(true); setErro('')
    try {
      const r = await fetch('/api/enderecamento/produtos/ajustar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          depositoId: escolhido.deposito_id, enderecoId: escolhido.id,
          produtoId, novaQuantidade: Number(quantidade),
          motivo: 'Endereçado pelo cadastro do produto',
        }),
      }).then(x => x.json())
      if (!r?.ok) { setErro(r?.erro ?? 'Não foi possível endereçar.'); return }
      setEscolhido(null); setBusca(''); setQuantidade('')
      await carregar()
    } finally {
      setSalvando(false)
    }
  }

  async function enviarFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    const alvo = alvoFoto
    if (inputFoto.current) inputFoto.current.value = ''
    if (!arquivo || !alvo) return

    setEnviandoFoto(alvo.id); setErro('')
    try {
      // Mesmo bucket das imagens de produto, com prefixo proprio. Criar um
      // bucket novo exigiria politica de acesso propria — e esta foto tem
      // exatamente a mesma sensibilidade das outras.
      const ext = arquivo.name.split('.').pop()?.toLowerCase() ?? 'jpg'
      const path = `enderecamento/${empresaId}/${alvo.id}-${Date.now()}.${ext}`
      const { error: up } = await sb.storage.from('produto-imagens').upload(path, arquivo)
      if (up) { setErro(`Falha no envio: ${up.message}`); return }
      const { data: { publicUrl } } = sb.storage.from('produto-imagens').getPublicUrl(path)

      // Quem grava a URL e a data e o servidor: a foto carrega a afirmacao
      // "estava assim", e a data dessa afirmacao nao pode vir do relogio de
      // quem envia.
      const r = await fetch('/api/enderecamento/produtos/foto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtoEnderecoId: alvo.id, fotoUrl: publicUrl }),
      }).then(x => x.json())
      if (!r?.ok) { setErro(r?.erro ?? 'Não foi possível salvar a foto.'); return }
      await carregar()
    } finally {
      setEnviandoFoto(null); setAlvoFoto(null)
    }
  }

  async function removerFoto(v: Vinculo) {
    if (!confirm('Remover a foto de referência deste endereço?')) return
    setEnviandoFoto(v.id)
    try {
      await fetch('/api/enderecamento/produtos/foto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtoEnderecoId: v.id, fotoUrl: null }),
      })
      await carregar()
    } finally { setEnviandoFoto(null) }
  }

  return (
    <div className="space-y-5">
      {erro && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{erro}</p>
      )}

      <div>
        <h3 className="text-sm font-semibold text-gray-800">Onde este produto está</h3>
        {carregando ? (
          <p className="mt-2 text-xs text-gray-400">Consultando…</p>
        ) : vinculos.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">
            Este produto ainda não está em nenhum endereço.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {vinculos.map(v => (
              <div key={v.id} className="flex items-start gap-3 rounded-lg border border-gray-200 p-3">
                {/* A FOTO E DO PRODUTO NESTE ENDERECO, e nao do endereco: ela
                    responde "e ESTA caixa", que e a duvida de quem separa dois
                    produtos parecidos guardados lado a lado. */}
                <div className="shrink-0">
                  {v.foto_url ? (
                    <a href={v.foto_url} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={v.foto_url} alt={`Produto em ${v.enderecos?.codigo_legivel ?? 'endereço'}`}
                        className="h-16 w-16 rounded-lg border border-gray-200 object-cover" />
                    </a>
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-gray-300 text-[10px] text-gray-400">
                      sem foto
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-medium text-gray-900">
                    {v.enderecos?.codigo_legivel ?? '—'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {Number(v.quantidade)} un
                    {Number(v.quantidade_reservada) > 0 && <> · {Number(v.quantidade_reservada)} reservada(s)</>}
                    {v.papel && <> · {v.papel}</>}
                  </p>
                  {v.enderecos?.descricao && (
                    <p className="text-[11px] text-gray-400">{v.enderecos.descricao}</p>
                  )}
                  {/* A DATA DA FOTO fica a vista. Uma foto de dois anos atras
                      descreve um deposito que pode ter mudado, e quem confere
                      precisa poder desconfiar dela sem perguntar a ninguem. */}
                  {v.foto_atualizada_em && (
                    <p className="text-[11px] text-gray-400">foto de {dataCurta(v.foto_atualizada_em)}</p>
                  )}

                  <div className="mt-1.5 flex gap-3">
                    <button type="button" disabled={enviandoFoto === v.id}
                      onClick={() => { setAlvoFoto(v); inputFoto.current?.click() }}
                      className="text-[11px] font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50">
                      {enviandoFoto === v.id ? 'enviando…' : v.foto_url ? 'trocar foto' : '+ foto de referência'}
                    </button>
                    {v.foto_url && (
                      <button type="button" onClick={() => void removerFoto(v)}
                        className="text-[11px] text-gray-400 hover:text-red-600">remover foto</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <input ref={inputFoto} type="file" accept="image/*" capture="environment"
        onChange={enviarFoto} className="hidden" />

      <div className="rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-800">Endereçar em outro lugar</h3>
        <p className="mt-0.5 text-xs text-gray-500">
          Grava pela mesma rota da tela de endereçamento — a quantidade informada passa a ser a do endereço.
        </p>

        {escolhido ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-blue-50 px-2.5 py-1.5 font-mono text-xs text-blue-700">
              {escolhido.codigo_legivel}
            </span>
            <input value={quantidade} onChange={e => setQuantidade(e.target.value)}
              type="number" min={0} placeholder="quantidade"
              className="w-28 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
            <button onClick={() => void enderecar()} disabled={salvando || !quantidade}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {salvando ? 'Salvando…' : 'Endereçar'}
            </button>
            <button onClick={() => { setEscolhido(null); setQuantidade('') }}
              className="text-xs text-gray-500 hover:text-gray-700">trocar</button>
          </div>
        ) : (
          <>
            <input value={busca}
              onChange={e => { setBusca(e.target.value); if (!e.target.value.trim()) setCandidatos([]) }}
              placeholder="Buscar endereço pelo código — ex.: A-01-02"
              className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            {candidatos.length > 0 && (
              <div className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
                {candidatos.map(c => (
                  <button key={c.id} onClick={() => setEscolhido(c)}
                    className="block w-full px-3 py-2 text-left font-mono text-xs text-gray-700 hover:bg-blue-50">
                    {c.codigo_legivel}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
