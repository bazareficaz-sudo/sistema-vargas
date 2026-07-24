'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type Plano = {
  id: string; nome: string; codigo: string; descricao: string | null
  preco_mensal: number; permite_trial: boolean; dias_trial: number
  exige_pagamento_inicial: boolean
  recomendado: boolean; cor: string
  plan_modules: { modulo: string }[]
}

type Step = 1 | 2 | 3 | 4 | 5

export default function SignupWizard({ onClose, planoInicial }: { onClose: () => void; planoInicial?: string }) {
  const sb = createClient()
  const [step, setStep] = useState<Step>(1)
  const [planos, setPlanos] = useState<Plano[]>([])
  const [carregandoPlanos, setCarregandoPlanos] = useState(true)
  const [planoId, setPlanoId] = useState<string>('')

  const [form, setForm] = useState({
    nome: '', email: '', senha: '', telefone: '',
    cnpj: '', razaoSocial: '', nomeFantasia: '', logradouro: '',
    numero: '', bairro: '', municipio: '', uf: '', cep: '',
  })
  const [consultandoCnpj, setConsultandoCnpj] = useState(false)
  const [erroCnpj, setErroCnpj] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState<'sucesso' | 'confirmar_email' | null>(null)

  function upd(field: string, value: unknown) {
    setForm(f => ({ ...f, [field]: value }))
  }

  useEffect(() => {
    sb.from('plans')
      .select('id, nome, codigo, descricao, preco_mensal, permite_trial, dias_trial, exige_pagamento_inicial, recomendado, cor, plan_modules(modulo)')
      .eq('publico', true).eq('ativo', true).order('ordem')
      .then(({ data }) => {
        const lista = (data ?? []) as unknown as Plano[]
        setPlanos(lista)
        const preSelecionado = lista.find(p => p.codigo === planoInicial) ?? lista.find(p => p.recomendado) ?? lista[0]
        if (preSelecionado) setPlanoId(preSelecionado.id)
        setCarregandoPlanos(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function consultarCnpj() {
    const cnpj = form.cnpj.replace(/\D/g, '')
    if (cnpj.length !== 14) { setErroCnpj('CNPJ deve ter 14 dígitos'); return }
    setConsultandoCnpj(true); setErroCnpj('')
    try {
      const res = await fetch(`/api/cnpj?cnpj=${cnpj}`)
      const data = await res.json()
      if (!res.ok) { setErroCnpj(data.error ?? 'CNPJ não encontrado'); return }
      setForm(f => ({ ...f, razaoSocial: data.razaoSocial, nomeFantasia: data.nomeFantasia,
        logradouro: data.logradouro, numero: data.numero, bairro: data.bairro,
        municipio: data.municipio, uf: data.uf, cep: data.cep }))
    } catch { setErroCnpj('Erro ao consultar CNPJ') }
    finally { setConsultandoCnpj(false) }
  }

  const planoSelecionado = planos.find(p => p.id === planoId) ?? null

  function validarDados() {
    if (!form.nome.trim()) return 'Informe seu nome.'
    if (!form.email.trim() || !form.email.includes('@')) return 'Informe um e-mail válido.'
    if (form.senha.length < 6) return 'A senha precisa ter pelo menos 6 caracteres.'
    return ''
  }

  function avancar() {
    if (step === 2) {
      const msg = validarDados()
      if (msg) { setErro(msg); return }
    }
    setErro('')
    setStep(s => Math.min(5, s + 1) as Step)
  }

  async function finalizar() {
    const msgValidacao = validarDados()
    if (msgValidacao) { setErro(msgValidacao); setStep(2); return }
    if (!planoSelecionado) { setErro('Selecione um plano.'); setStep(1); return }

    setLoading(true); setErro('')
    try {
      const { data, error: authErr } = await sb.auth.signUp({
        email: form.email, password: form.senha,
        options: {
          data: {
            nome: form.nome, telefone: form.telefone,
            pending_signup: {
              nome: form.nome, telefone: form.telefone,
              cnpj: form.cnpj, razaoSocial: form.razaoSocial, nomeFantasia: form.nomeFantasia,
              endereco: {
                cep: form.cep, logradouro: form.logradouro, numero: form.numero,
                bairro: form.bairro, municipio: form.municipio, uf: form.uf,
              },
              planoCodigo: planoSelecionado.codigo,
            },
          },
        },
      })
      if (authErr) { setErro(authErr.message); return }

      if (data.session) {
        const res = await fetch('/api/signup/provisionar', { method: 'POST' })
        const resultadoProv = await res.json()
        if (!resultadoProv.ok) { setErro(resultadoProv.error ?? 'Erro ao criar sua empresa.'); return }

        if (planoSelecionado.exige_pagamento_inicial) {
          const resPag = await fetch('/api/mercadopago/criar-assinatura', { method: 'POST' })
          const resultadoPag = await resPag.json()
          if (!resultadoPag.ok) { setErro(resultadoPag.error ?? 'Erro ao iniciar o pagamento.'); return }
          window.location.href = resultadoPag.init_point
          return
        }

        setResultado('sucesso')
      } else {
        setResultado('confirmar_email')
      }
      setStep(5)
    } catch (e: any) {
      setErro(e.message ?? 'Erro inesperado')
    } finally { setLoading(false) }
  }

  const steps = ['Plano', 'Dados', 'Empresa', 'Resumo', 'Pronto']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 border-b border-gray-100">
          <div>
            <p className="text-xs text-gray-400 mb-1">Etapa {step} de 5</p>
            <h2 className="text-lg font-bold text-gray-900">{steps[step - 1]}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {/* Progress */}
        <div className="flex gap-1 px-7 py-3 bg-gray-50 border-b border-gray-100">
          {steps.map((s, i) => (
            <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${i < step ? 'bg-blue-600' : 'bg-gray-200'}`} />
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-7 py-6">

          {/* STEP 1 — Plano */}
          {step === 1 && (
            <div>
              <p className="text-sm text-gray-500 mb-5">Escolha o plano que melhor se encaixa ao seu negócio</p>
              {carregandoPlanos && <p className="text-sm text-gray-400">Carregando planos...</p>}
              {!carregandoPlanos && planos.length === 0 && <p className="text-sm text-red-500">Nenhum plano disponível no momento.</p>}
              <div className="grid grid-cols-3 gap-3">
                {planos.map(p => {
                  const mods = p.plan_modules?.map(m => m.modulo) ?? []
                  return (
                    <button key={p.id} onClick={() => setPlanoId(p.id)}
                      className={`rounded-2xl border-2 p-4 text-left transition-all ${planoId === p.id ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      {p.recomendado && <span className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded-full font-bold">POPULAR</span>}
                      <p className="font-bold text-gray-900 mt-1">{p.nome}</p>
                      <p className="text-2xl font-black text-blue-600 mt-1">R$ {p.preco_mensal}<span className="text-xs text-gray-400 font-normal">/mês</span></p>
                      <p className="text-xs text-gray-500 mt-1">{p.descricao}</p>
                      {p.permite_trial && <p className="text-xs text-emerald-600 mt-2 font-medium">✓ {p.dias_trial} dias grátis</p>}
                      <ul className="mt-3 space-y-1">
                        {mods.slice(0, 6).map(m => (
                          <li key={m} className="text-xs text-gray-600 flex items-start gap-1.5">
                            <span className="text-emerald-500 mt-0.5">✓</span><span className="capitalize">{m.replace(/_/g, ' ')}</span>
                          </li>
                        ))}
                      </ul>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* STEP 2 — Dados pessoais */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500 mb-2">Seus dados de acesso ao sistema</p>
              {[
                { label: 'Nome completo', field: 'nome', type: 'text', placeholder: 'João da Silva' },
                { label: 'E-mail', field: 'email', type: 'email', placeholder: 'joao@empresa.com' },
                { label: 'Telefone / WhatsApp', field: 'telefone', type: 'tel', placeholder: '(11) 99999-9999' },
                { label: 'Senha', field: 'senha', type: 'password', placeholder: 'Mínimo 6 caracteres' },
              ].map(f => (
                <div key={f.field}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                  <input type={f.type} placeholder={f.placeholder}
                    value={(form as any)[f.field]} onChange={e => upd(f.field, e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                </div>
              ))}
              {erro && <p className="text-red-500 text-xs">{erro}</p>}
            </div>
          )}

          {/* STEP 3 — Empresa */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500 mb-2">Informações da sua empresa (opcional agora, dá pra completar depois)</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CNPJ</label>
                <div className="flex gap-2">
                  <input value={form.cnpj} onChange={e => upd('cnpj', e.target.value)}
                    placeholder="00.000.000/0001-00" maxLength={18}
                    className="flex-1 border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                  <button onClick={consultarCnpj} disabled={consultandoCnpj}
                    className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl disabled:opacity-50 whitespace-nowrap">
                    {consultandoCnpj ? '...' : 'Consultar'}
                  </button>
                </div>
                {erroCnpj && <p className="text-red-500 text-xs mt-1">{erroCnpj}</p>}
              </div>
              {[
                { label: 'Razão Social', field: 'razaoSocial' },
                { label: 'Nome Fantasia', field: 'nomeFantasia' },
                { label: 'Logradouro', field: 'logradouro' },
                { label: 'Número', field: 'numero' },
                { label: 'Bairro', field: 'bairro' },
                { label: 'Município', field: 'municipio' },
                { label: 'UF', field: 'uf' },
              ].map(f => (
                <div key={f.field}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                  <input value={(form as any)[f.field]} onChange={e => upd(f.field, e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                </div>
              ))}
            </div>
          )}

          {/* STEP 4 — Resumo */}
          {step === 4 && (
            <div>
              <p className="text-sm text-gray-500 mb-5">Revise antes de criar sua conta</p>
              <div className="bg-gray-50 rounded-2xl p-5 space-y-3">
                <div className="flex justify-between text-sm"><span className="text-gray-600">Plano</span><span className="font-semibold">{planoSelecionado?.nome ?? '—'}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-600">Mensalidade</span><span className="font-semibold">R$ {planoSelecionado?.preco_mensal ?? 0},00/mês</span></div>
                {planoSelecionado?.permite_trial && (
                  <div className="flex justify-between text-sm"><span className="text-gray-600">Período grátis</span><span className="font-semibold text-emerald-600">{planoSelecionado.dias_trial} dias</span></div>
                )}
                <div className="flex justify-between text-sm"><span className="text-gray-600">E-mail de acesso</span><span>{form.email}</span></div>
              </div>
              {planoSelecionado?.exige_pagamento_inicial ? (
                <div className="mt-4 bg-amber-50 rounded-xl p-4">
                  <p className="text-sm text-amber-800 font-semibold">Este plano exige pagamento antes de liberar o acesso</p>
                  <p className="text-xs text-amber-700 mt-1">Depois de criar sua conta, você será redirecionado para o Mercado Pago pra autorizar a cobrança recorrente. Seu acesso é liberado assim que o pagamento for confirmado.</p>
                </div>
              ) : (
                <div className="mt-4 bg-blue-50 rounded-xl p-4">
                  <p className="text-sm text-blue-800 font-semibold">Nenhum pagamento é necessário agora</p>
                  <p className="text-xs text-blue-700 mt-1">Vamos pedir a forma de pagamento mais adiante, antes do fim do seu período grátis. Você já entra no sistema hoje.</p>
                </div>
              )}
              {erro && <p className="text-red-500 text-sm text-center mt-4">{erro}</p>}
            </div>
          )}

          {/* STEP 5 — Pronto */}
          {step === 5 && resultado === 'sucesso' && (
            <div className="text-center py-6">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5">
                <span className="text-4xl">🎉</span>
              </div>
              <h3 className="text-2xl font-black text-gray-900 mb-2">Sua conta está pronta!</h3>
              <p className="text-gray-500 mb-6">
                Sua empresa foi cadastrada e seu usuário administrador já pode entrar
                {planoSelecionado?.permite_trial ? ` — você tem ${planoSelecionado.dias_trial} dias grátis para explorar tudo.` : '.'}
              </p>
              <a href="/dashboard" className="inline-block px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors">
                Entrar no Sistema →
              </a>
            </div>
          )}
          {step === 5 && resultado === 'confirmar_email' && (
            <div className="text-center py-6">
              <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-5">
                <span className="text-4xl">✉️</span>
              </div>
              <h3 className="text-2xl font-black text-gray-900 mb-2">Confirme seu e-mail</h3>
              <p className="text-gray-500 mb-2">Enviamos um link de confirmação para <strong>{form.email}</strong>.</p>
              <p className="text-gray-500 mb-6">Assim que você confirmar, sua empresa e seu usuário administrador são criados automaticamente e você já entra no sistema.</p>
              <button onClick={onClose} className="px-8 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-colors">
                Fechar
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {step < 5 && (
          <div className="flex items-center justify-between px-7 py-4 border-t border-gray-100 bg-gray-50">
            {step > 1 ? (
              <button onClick={() => setStep((step - 1) as Step)}
                className="px-5 py-2.5 border border-gray-300 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-100 transition-colors">
                ← Voltar
              </button>
            ) : <div />}
            {step < 4 ? (
              <button onClick={avancar} disabled={step === 1 && !planoSelecionado}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50">
                Continuar →
              </button>
            ) : (
              <button onClick={finalizar} disabled={loading}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-60">
                {loading ? 'Processando...' : '✓ Criar minha conta'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
