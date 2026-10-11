'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useCarrinho } from './CarrinhoContexto'
import { EstadoVazio, classesBotao, estiloPrimario, real } from './ds'
import { PAGAMENTO_LABEL } from '@/lib/commerce/pedido'
import type { ResultadoFrete } from '@/lib/commerce/frete/calculo'

// Checkout — a tela que transforma a vitrine em loja.
//
// Uma página só, sem passos. Um fluxo de três etapas com barra de progresso é
// o padrão de loja grande, e ali faz sentido porque há pagamento no meio;
// aqui não há: o pedido é registrado e a loja combina o resto. Repartir esta
// tela em três seria três chances de o cliente desistir para preencher os
// mesmos oito campos.
//
// O que NÃO fica aqui: conferir preço e saldo. Isso é do servidor, e do banco
// depois dele — `loja_criar_pedido` reconfere tudo com a trava tomada. Esta
// tela pode mostrar um total que envelheceu; o pedido nunca nasce com ele.

type Campo = { nome: string; rotulo: string; largura?: 'meia' | 'inteira'; max?: number; dica?: string }

const CAMPOS_ENTREGA: Campo[] = [
  { nome: 'cep', rotulo: 'CEP', largura: 'meia', max: 9 },
  { nome: 'logradouro', rotulo: 'Rua', largura: 'inteira', max: 200 },
  { nome: 'numero', rotulo: 'Número', largura: 'meia', max: 20 },
  { nome: 'complemento', rotulo: 'Complemento', largura: 'meia', max: 100 },
  { nome: 'bairro', rotulo: 'Bairro', largura: 'meia', max: 100 },
  { nome: 'cidade', rotulo: 'Cidade', largura: 'meia', max: 100 },
  { nome: 'uf', rotulo: 'UF', largura: 'meia', max: 2 },
]

const soDigitos = (v: string) => v.replace(/\D/g, '')

export default function CheckoutCliente({
  entregaAtiva, retiradaAtiva, pagamentoFormas, enderecoLoja, freteAtivo,
}: {
  entregaAtiva: boolean
  retiradaAtiva: boolean
  pagamentoFormas: string[]
  /** Para onde o cliente vai, quando escolhe retirar. */
  enderecoLoja: string | null
  /** A loja calcula frete? Falso mantém o fluxo antigo: valor combinado. */
  freteAtivo: boolean
}) {
  const router = useRouter()
  const { itens, quantidadeTotal, carregado, limpar } = useCarrinho()

  const [modo, setModo] = useState<'entrega' | 'retirada'>(entregaAtiva ? 'entrega' : 'retirada')
  const [form, setForm] = useState<Record<string, string>>({})
  const [pagamento, setPagamento] = useState(pagamentoFormas[0] ?? 'pix')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [recusados, setRecusados] = useState<{ nome: string; disponivel: number }[]>([])

  // ── Frete ────────────────────────────────────────────────
  // A cotação guarda a CHAVE do endereço/carrinho para o qual foi feita. O que
  // a tela mostra é derivado: cotação de outro CEP ou de outro carrinho não
  // aparece, sem precisar zerar estado dentro do efeito.
  const [cotacao, setCotacao] = useState<
    { chave: string; resultado: ResultadoFrete | null; erro: string | null } | null
  >(null)
  const [servico, setServico] = useState<string | null>(null)
  const autopreenchidos = useRef<Set<string>>(new Set())

  // Campo digitado pelo cliente deixa de ser "do CEP": uma nova consulta não o sobrescreve.
  const set = (k: string, v: string) => {
    autopreenchidos.current.delete(k)
    setForm(f => ({ ...f, [k]: v }))
  }

  const calculaFrete = freteAtivo && modo === 'entrega'
  const cep8 = soDigitos(form.cep ?? '')
  const chaveItens = itens.map(i => `${i.produtoId}:${i.quantidade}`).join(',')

  const chaveAtual = [cep8, form.bairro ?? '', form.cidade ?? '', form.uf ?? '', chaveItens].join('|')
  const cotacaoAtual = cotacao?.chave === chaveAtual ? cotacao : null
  const frete = calculaFrete && cep8.length === 8 ? cotacaoAtual?.resultado ?? null : null
  const erroFrete = calculaFrete && cep8.length === 8 ? cotacaoAtual?.erro ?? null : null
  const cotando = calculaFrete && cep8.length === 8 && !cotacaoAtual

  useEffect(() => {
    if (!calculaFrete || cep8.length !== 8 || cotacao?.chave === chaveAtual) return
    const chave = chaveAtual

    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/loja/frete', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cep: cep8, bairro: form.bairro, cidade: form.cidade, uf: form.uf,
            itens: itens.map(i => ({ produtoId: i.produtoId, quantidade: i.quantidade })),
          }),
        })
        const d = await r.json()
        if (!r.ok || !d.ativo) {
          setCotacao({ chave, resultado: null, erro: d.erro ?? 'Não foi possível calcular a entrega agora.' })
          return
        }

        // Preenche só o que está vazio ou veio de uma consulta anterior.
        const e = d.endereco as { logradouro: string; bairro: string; cidade: string; uf: string }
        const novo = { ...form }
        for (const k of ['logradouro', 'bairro', 'cidade', 'uf'] as const) {
          if (e[k] && (!form[k]?.trim() || autopreenchidos.current.has(k))) {
            novo[k] = e[k]; autopreenchidos.current.add(k)
          }
        }
        setForm(novo)
        // A cotação é gravada com a chave que INCLUI o que acabou de ser
        // preenchido, para o efeito não consultar de novo por causa do
        // próprio preenchimento.
        const chaveFinal = [cep8, novo.bairro ?? '', novo.cidade ?? '', novo.uf ?? '', chaveItens].join('|')
        const res = d.resultado as ResultadoFrete
        setCotacao({ chave: chaveFinal, resultado: res, erro: null })
        setServico(s => res.status === 'opcoes'
          ? (res.opcoes.some(o => o.servico === s) ? s : res.opcoes[0].servico)
          : null)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setCotacao({ chave, resultado: null, erro: 'Não foi possível calcular a entrega agora.' })
        }
      }
    }, 400)

    return () => { clearTimeout(t); ctrl.abort() }
    // `form` inteiro fica fora das dependências de propósito: só CEP, bairro,
    // cidade e UF disparam nova cotação, não o nome nem a observação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculaFrete, cep8, chaveAtual, cotacao?.chave])

  const opcaoEscolhida = frete?.status === 'opcoes'
    ? frete.opcoes.find(o => o.servico === servico) ?? frete.opcoes[0]
    : null
  const valorFrete = opcaoEscolhida?.valor ?? 0
  const subtotal = itens.reduce((s, i) => s + i.precoVisto * i.quantidade, 0)
  const total = subtotal + valorFrete

  async function enviar() {
    setEnviando(true); setErro(null); setRecusados([])
    try {
      const r = await fetch('/api/loja/pedido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itens: itens.map(i => ({ produtoId: i.produtoId, quantidade: i.quantidade })),
          cliente: { nome: form.nome, telefone: form.telefone, doc: form.doc, email: form.email },
          entrega: { modo, ...form },
          pagamento,
          observacao: form.observacao,
          site: form.site,
          frete: calculaFrete && opcaoEscolhida
            ? { servico: opcaoEscolhida.servico, valor: opcaoEscolhida.valor }
            : undefined,
        }),
      })
      const dados = await r.json()
      if (!r.ok) {
        setErro(dados.erro ?? 'Não foi possível concluir o pedido.')
        // O valor da entrega mudou entre a cotação e o Confirmar: mostra o
        // novo e deixa o cliente decidir, em vez de cobrar outro valor.
        if (dados.frete) {
          const res = dados.frete as ResultadoFrete
          setCotacao({ chave: chaveAtual, resultado: res, erro: null })
          setServico(res.status === 'opcoes' ? res.opcoes[0].servico : null)
        }
        if (Array.isArray(dados.itens)) setRecusados(dados.itens)
        return
      }
      // O carrinho só é esvaziado DEPOIS de o pedido existir. Limpar antes,
      // otimista, deixaria o cliente sem carrinho e sem pedido se falhasse.
      limpar()
      router.push(`/pedido/${encodeURIComponent(dados.numero)}`)
    } catch {
      setErro('Sem conexão. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  if (!carregado) return <div className="loja-container py-16" />

  if (quantidadeTotal === 0) {
    return (
      <EstadoVazio
        titulo="Seu carrinho está vazio"
        descricao="Escolha os produtos e volte aqui para fechar o pedido."
        acao={<Link href="/" className={classesBotao('primario')} style={estiloPrimario}>Ver produtos</Link>}
      />
    )
  }

  const faltaEndereco = modo === 'entrega'
    && ['logradouro', 'numero', 'bairro', 'cidade'].some(k => !form[k]?.trim())
  // Com frete calculado, o pedido só sai com a entrega resolvida: opção
  // escolhida, ou "a combinar". Entrega indisponível ou ainda cotando barra.
  const freteResolvido = !calculaFrete
    || (cep8.length === 8 && !cotando && !!frete && frete.status !== 'indisponivel')
  const podeEnviar = !!form.nome?.trim()
    && (form.telefone ?? '').replace(/\D/g, '').length >= 10
    && !faltaEndereco && freteResolvido && !enviando

  return (
    <div className="loja-container grid gap-6 py-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-5">
        <Secao titulo="Seus dados">
          <div className="grid gap-3 sm:grid-cols-2">
            <Entrada rotulo="Nome completo" valor={form.nome ?? ''} onChange={v => set('nome', v)} inteira obrigatorio />
            <Entrada rotulo="WhatsApp com DDD" valor={form.telefone ?? ''} onChange={v => set('telefone', v)} obrigatorio
              dica="É por aqui que a loja combina entrega e pagamento." />
            <Entrada rotulo="CPF (opcional)" valor={form.doc ?? ''} onChange={v => set('doc', v)}
              dica="Só se quiser CPF na nota." />
          </div>
        </Secao>

        {entregaAtiva && retiradaAtiva && (
          <Secao titulo="Como você quer receber">
            <div className="flex flex-wrap gap-2">
              {(['entrega', 'retirada'] as const).map(m => (
                <button key={m} onClick={() => setModo(m)}
                  className={`rounded-[10px] border px-4 py-2 text-sm font-semibold ${
                    modo === m
                      ? 'border-transparent text-white'
                      : 'border-[var(--borda)] bg-white text-[var(--tinta-forte)]'}`}
                  style={modo === m ? estiloPrimario : undefined}>
                  {m === 'entrega' ? 'Entrega' : 'Retirar na loja'}
                </button>
              ))}
            </div>
          </Secao>
        )}

        {modo === 'entrega' && (
          <Secao titulo="Endereço de entrega">
            <div className="grid gap-3 sm:grid-cols-2">
              {CAMPOS_ENTREGA.map(c => (
                <Entrada key={c.nome} rotulo={c.rotulo} valor={form[c.nome] ?? ''}
                  onChange={v => set(c.nome, v)} inteira={c.largura === 'inteira'}
                  obrigatorio={['logradouro', 'numero', 'bairro', 'cidade'].includes(c.nome)} />
              ))}
            </div>
            {!freteAtivo && (
              <p className="mt-2 text-xs text-[var(--tinta-media)]">
                O valor da entrega é combinado pela loja no WhatsApp — ele não entra neste total.
              </p>
            )}
          </Secao>
        )}

        {modo === 'entrega' && freteAtivo && (
          <Secao titulo="Valor da entrega">
            {cep8.length !== 8 ? (
              <p className="text-sm text-[var(--tinta-media)]">Informe o CEP acima para calcular a entrega.</p>
            ) : cotando ? (
              <p className="text-sm text-[var(--tinta-media)]" aria-live="polite">Calculando a entrega…</p>
            ) : erroFrete ? (
              <p className="text-sm text-[var(--alerta)]" role="alert">{erroFrete}</p>
            ) : frete?.status === 'opcoes' ? (
              <div className="space-y-2" role="radiogroup" aria-label="Opções de entrega">
                {frete.opcoes.map(o => (
                  <label key={o.servico}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-[10px] border p-3 text-sm ${
                      opcaoEscolhida?.servico === o.servico
                        ? 'border-[var(--loja-primaria)] bg-[var(--fundo-suave)]'
                        : 'border-[var(--borda)]'}`}>
                    <span className="flex items-center gap-2">
                      <input type="radio" name="servico" checked={opcaoEscolhida?.servico === o.servico}
                        onChange={() => setServico(o.servico)} />
                      <span>
                        <span className="font-medium text-[var(--tinta-forte)]">{o.servico}</span>
                        {o.prazo && <span className="block text-xs text-[var(--tinta-media)]">{o.prazo}</span>}
                      </span>
                    </span>
                    <span className="font-semibold">
                      {o.valor > 0 ? real(o.valor) : <span style={{ color: 'var(--sucesso)' }}>Grátis</span>}
                    </span>
                  </label>
                ))}
              </div>
            ) : frete?.status === 'combinar' ? (
              <p className="text-sm text-[var(--tinta-media)]">
                {frete.motivo} A loja chama no WhatsApp para combinar o valor — ele não entra neste total.
              </p>
            ) : frete?.status === 'indisponivel' ? (
              <div role="alert">
                <p className="text-sm font-medium text-[var(--alerta)]">{frete.motivo}</p>
                {frete.itensSomenteRetirada && (
                  <ul className="mt-1 list-disc pl-4 text-xs text-[var(--tinta-media)]">
                    {frete.itensSomenteRetirada.map(n => <li key={n}>{n}</li>)}
                  </ul>
                )}
                {retiradaAtiva && (
                  <button onClick={() => setModo('retirada')}
                    className="mt-2 text-sm font-semibold underline">
                    Retirar na loja
                  </button>
                )}
              </div>
            ) : null}
          </Secao>
        )}

        {modo === 'retirada' && (
          <Secao titulo="Retirada na loja">
            <p className="text-sm text-[var(--tinta-media)]">
              {enderecoLoja ?? 'A loja informa o endereço de retirada no contato.'}
            </p>
          </Secao>
        )}

        {pagamentoFormas.length > 0 && (
          <Secao titulo="Pagamento">
            <div className="flex flex-wrap gap-2">
              {pagamentoFormas.map(f => (
                <button key={f} onClick={() => setPagamento(f)}
                  className={`rounded-[10px] border px-4 py-2 text-sm font-semibold ${
                    pagamento === f
                      ? 'border-transparent text-white'
                      : 'border-[var(--borda)] bg-white text-[var(--tinta-forte)]'}`}
                  style={pagamento === f ? estiloPrimario : undefined}>
                  {PAGAMENTO_LABEL[f] ?? f}
                </button>
              ))}
            </div>
            {/* Dito com todas as letras: a loja não cobra aqui. Deixar
                ambíguo faria o cliente esperar uma tela de pagamento que
                não existe, e abandonar o pedido achando que falhou. */}
            <p className="mt-2 text-xs text-[var(--tinta-media)]">
              Você <strong>não paga agora</strong>. O pagamento é combinado na{' '}
              {modo === 'entrega' ? 'entrega' : 'retirada'}.
            </p>
          </Secao>
        )}

        <Secao titulo="Observação (opcional)">
          <textarea value={form.observacao ?? ''} onChange={ev => set('observacao', ev.target.value)}
            rows={3} maxLength={500}
            placeholder="Ponto de referência, horário melhor para entrega…"
            className="w-full rounded-[10px] border border-[var(--borda)] p-3 text-sm outline-none focus:border-[var(--loja-primaria)]" />
        </Secao>
      </div>

      {/* Resumo. `sticky` no desktop porque o formulário é longo e o botão
          não pode ficar a uma rolagem de distância do total. */}
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-[var(--raio)] border border-[var(--borda)] bg-white p-4">
          <h2 className="font-semibold text-[var(--tinta-forte)]">Resumo</h2>
          <ul className="mt-3 space-y-2">
            {itens.map(i => (
              <li key={i.produtoId} className="flex justify-between gap-3 text-sm">
                <span className="loja-linhas-2 text-[var(--tinta-media)]">{i.quantidade}× {i.nome}</span>
                <span className="shrink-0 font-medium">{real(i.precoVisto * i.quantidade)}</span>
              </li>
            ))}
          </ul>
          {calculaFrete && (
            <div className="mt-3 flex justify-between border-t border-[var(--borda)] pt-3 text-sm text-[var(--tinta-media)]">
              <span>Entrega</span>
              <span>
                {opcaoEscolhida
                  ? (opcaoEscolhida.valor > 0 ? real(opcaoEscolhida.valor) : 'Grátis')
                  : frete?.status === 'combinar' ? 'A combinar' : '—'}
              </span>
            </div>
          )}
          <div className={`${calculaFrete ? 'mt-2' : 'mt-3 border-t border-[var(--borda)] pt-3'} flex justify-between`}>
            <span className="font-semibold">Total</span>
            <span className="text-lg font-bold">{real(total)}</span>
          </div>

          {erro && (
            <div className="mt-3 rounded-[10px] border border-[var(--alerta)] bg-amber-50 p-3">
              <p className="text-sm font-medium text-[var(--alerta)]">{erro}</p>
              {recusados.length > 0 && (
                <>
                  <ul className="mt-1 list-disc pl-4 text-xs text-[var(--tinta-media)]">
                    {recusados.map(i => (
                      <li key={i.nome}>
                        {i.nome} — {i.disponivel > 0 ? `restam ${i.disponivel}` : 'esgotado'}
                      </li>
                    ))}
                  </ul>
                  <Link href="/carrinho" className="mt-2 inline-block text-xs font-semibold underline">
                    Voltar ao carrinho e ajustar
                  </Link>
                </>
              )}
            </div>
          )}

          <button onClick={enviar} disabled={!podeEnviar}
            className={`${classesBotao('primario')} mt-4 w-full`} style={estiloPrimario}>
            {enviando ? 'Enviando…' : 'Confirmar pedido'}
          </button>
          {/* Isca para robô: fora da tela e fora da ordem de tabulação. */}
          <input
            type="text" name="site" tabIndex={-1} autoComplete="off" aria-hidden="true"
            value={form.site ?? ''} onChange={e => set('site', e.target.value)}
            style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
          />
          <p className="mt-2 text-center text-[0.6875rem] text-[var(--tinta-fraca)]">
            Ao confirmar, a loja recebe seu pedido e entra em contato. Leia a{' '}
            <Link href="/p/privacidade" className="underline">política de privacidade</Link>{' '}
            e as <Link href="/p/trocas-e-devolucoes" className="underline">trocas e devoluções</Link>.
          </p>
        </div>
      </aside>
    </div>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--raio)] border border-[var(--borda)] bg-white p-4">
      <h2 className="mb-3 font-semibold text-[var(--tinta-forte)]">{titulo}</h2>
      {children}
    </section>
  )
}

function Entrada({ rotulo, valor, onChange, inteira, obrigatorio, dica }: {
  rotulo: string; valor: string; onChange: (v: string) => void
  inteira?: boolean; obrigatorio?: boolean; dica?: string
}) {
  return (
    <label className={inteira ? 'sm:col-span-2' : ''}>
      <span className="block text-xs font-medium text-[var(--tinta-media)]">
        {rotulo}{obrigatorio && <span className="text-[var(--alerta)]"> *</span>}
      </span>
      <input value={valor} onChange={e => onChange(e.target.value)}
        className="mt-1 h-11 w-full rounded-[10px] border border-[var(--borda)] px-3 text-sm outline-none focus:border-[var(--loja-primaria)]" />
      {dica && <span className="mt-0.5 block text-[0.6875rem] text-[var(--tinta-fraca)]">{dica}</span>}
    </label>
  )
}
