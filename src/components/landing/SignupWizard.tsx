'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const PLANOS = [
  {
    id: 'starter', nome: 'Starter', preco: 97,
    descricao: 'Ideal para pequenos negócios',
    recursos: ['1 empresa', 'Até 3 usuários', 'PDV', 'Estoque', 'Financeiro básico', 'WhatsApp'],
  },
  {
    id: 'professional', nome: 'Professional', preco: 197,
    descricao: 'Para empresas em crescimento', destaque: true,
    recursos: ['Até 3 empresas', 'Até 10 usuários', 'Tudo do Starter', 'PDV Offline', 'Marketplaces', 'Compras / XML', 'Relatórios BI', 'Multiempresa'],
  },
  {
    id: 'enterprise', nome: 'Enterprise', preco: 397,
    descricao: 'Para grandes operações',
    recursos: ['Empresas ilimitadas', 'Usuários ilimitados', 'Tudo do Professional', 'API aberta', 'Suporte prioritário', 'Implantação assistida', 'Personalizações'],
  },
]

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7

export default function SignupWizard({ onClose, planoInicial }: { onClose: () => void; planoInicial?: string }) {
  const [step, setStep] = useState<Step>(planoInicial ? 2 : 1)
  const [plano, setPlano] = useState(planoInicial ?? 'professional')
  const [form, setForm] = useState({
    nome: '', email: '', senha: '', telefone: '',
    cnpj: '', razaoSocial: '', nomeFantasia: '', logradouro: '',
    numero: '', bairro: '', municipio: '', uf: '', cep: '',
    qtdUsuarios: 3, qtdEmpresas: 1, addMarketplace: false, addPdvOffline: false,
  })
  const [consultandoCnpj, setConsultandoCnpj] = useState(false)
  const [erroCnpj, setErroCnpj] = useState('')
  const [pagamento, setPagamento] = useState<'pix' | 'cartao' | 'boleto'>('pix')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')

  function upd(field: string, value: unknown) {
    setForm(f => ({ ...f, [field]: value }))
  }

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

  const planoObj = PLANOS.find(p => p.id === plano)!
  const totalMensal = planoObj.preco

  async function finalizar() {
    setLoading(true); setErro('')
    try {
      const sb = createClient()
      const { error: authErr } = await sb.auth.signUp({
        email: form.email, password: form.senha,
        options: { data: { nome: form.nome, telefone: form.telefone } },
      })
      if (authErr) { setErro(authErr.message); return }
      setStep(7)
    } catch (e: any) {
      setErro(e.message ?? 'Erro inesperado')
    } finally { setLoading(false) }
  }

  const steps = ['Plano', 'Dados', 'Empresa', 'Adicionais', 'Resumo', 'Pagamento', 'Pronto']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 border-b border-gray-100">
          <div>
            <p className="text-xs text-gray-400 mb-1">Etapa {step} de 7</p>
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
              <div className="grid grid-cols-3 gap-3">
                {PLANOS.map(p => (
                  <button key={p.id} onClick={() => setPlano(p.id)}
                    className={`rounded-2xl border-2 p-4 text-left transition-all ${plano === p.id ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    {p.destaque && <span className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded-full font-bold">POPULAR</span>}
                    <p className="font-bold text-gray-900 mt-1">{p.nome}</p>
                    <p className="text-2xl font-black text-blue-600 mt-1">R$ {p.preco}<span className="text-xs text-gray-400 font-normal">/mês</span></p>
                    <p className="text-xs text-gray-500 mt-1">{p.descricao}</p>
                    <ul className="mt-3 space-y-1">
                      {p.recursos.map(r => (
                        <li key={r} className="text-xs text-gray-600 flex items-start gap-1.5">
                          <span className="text-emerald-500 mt-0.5">✓</span>{r}
                        </li>
                      ))}
                    </ul>
                  </button>
                ))}
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
                { label: 'Senha', field: 'senha', type: 'password', placeholder: 'Mínimo 8 caracteres' },
              ].map(f => (
                <div key={f.field}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                  <input type={f.type} placeholder={f.placeholder}
                    value={(form as any)[f.field]} onChange={e => upd(f.field, e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                </div>
              ))}
            </div>
          )}

          {/* STEP 3 — Empresa */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500 mb-2">Informações da sua empresa</p>
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

          {/* STEP 4 — Adicionais */}
          {step === 4 && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500">Personalize sua contratação</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Quantidade de usuários</label>
                <div className="flex items-center gap-4">
                  <input type="range" min={1} max={50} value={form.qtdUsuarios} onChange={e => upd('qtdUsuarios', Number(e.target.value))}
                    className="flex-1 accent-blue-600" />
                  <span className="text-2xl font-bold text-blue-600 w-10 text-right">{form.qtdUsuarios}</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Quantidade de empresas</label>
                <div className="flex items-center gap-4">
                  <input type="range" min={1} max={20} value={form.qtdEmpresas} onChange={e => upd('qtdEmpresas', Number(e.target.value))}
                    className="flex-1 accent-blue-600" />
                  <span className="text-2xl font-bold text-blue-600 w-10 text-right">{form.qtdEmpresas}</span>
                </div>
              </div>
              <div className="space-y-3">
                {[
                  { field: 'addMarketplace', label: 'Integração Marketplace (Shopee, ML, Amazon...)', preco: '+ R$ 49/mês' },
                  { field: 'addPdvOffline', label: 'PDV Offline Desktop', preco: 'Incluso no Professional+' },
                ].map(opt => (
                  <label key={opt.field} className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-colors">
                    <input type="checkbox" checked={(form as any)[opt.field]} onChange={e => upd(opt.field, e.target.checked)}
                      className="w-5 h-5 rounded accent-blue-600" />
                    <div>
                      <p className="text-sm font-medium text-gray-800">{opt.label}</p>
                      <p className="text-xs text-gray-500">{opt.preco}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* STEP 5 — Resumo */}
          {step === 5 && (
            <div>
              <p className="text-sm text-gray-500 mb-5">Revise sua assinatura antes de prosseguir</p>
              <div className="bg-gray-50 rounded-2xl p-5 space-y-3">
                <div className="flex justify-between text-sm"><span className="text-gray-600">Plano {planoObj.nome}</span><span className="font-semibold">R$ {planoObj.preco},00/mês</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-600">Usuários</span><span>{form.qtdUsuarios}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-600">Empresas</span><span>{form.qtdEmpresas}</span></div>
                {form.addMarketplace && <div className="flex justify-between text-sm"><span className="text-gray-600">+ Marketplaces</span><span className="font-semibold">R$ 49,00/mês</span></div>}
                <div className="border-t border-gray-200 pt-3 flex justify-between font-bold text-base">
                  <span>Total mensal</span>
                  <span className="text-blue-600">R$ {totalMensal + (form.addMarketplace ? 49 : 0)},00</span>
                </div>
              </div>
              <div className="mt-4 bg-blue-50 rounded-xl p-4">
                <p className="text-xs text-blue-700 font-medium">✓ Sem fidelidade — cancele quando quiser</p>
                <p className="text-xs text-blue-700 font-medium mt-1">✓ 14 dias grátis para testar sem cobrar</p>
                <p className="text-xs text-blue-700 font-medium mt-1">✓ Suporte brasileiro incluso em todos os planos</p>
              </div>
            </div>
          )}

          {/* STEP 6 — Pagamento */}
          {step === 6 && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500">Escolha a forma de pagamento</p>
              <div className="grid grid-cols-3 gap-3">
                {([['pix','PIX','⚡ Aprovação imediata'],['cartao','Cartão','💳 Recorrente automático'],['boleto','Boleto','📄 Vence em 3 dias']] as const).map(([id, label, sub]) => (
                  <button key={id} onClick={() => setPagamento(id)}
                    className={`rounded-2xl border-2 p-4 text-center transition-all ${pagamento === id ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <p className="font-bold text-gray-900 text-sm">{label}</p>
                    <p className="text-[11px] text-gray-400 mt-1">{sub}</p>
                  </button>
                ))}
              </div>
              {pagamento === 'pix' && (
                <div className="bg-gray-50 rounded-2xl p-5 text-center">
                  <p className="text-sm text-gray-600 mb-3">Escaneie o QR Code ou copie a chave PIX</p>
                  <div className="w-32 h-32 bg-gray-200 rounded-xl mx-auto flex items-center justify-center text-gray-400 text-xs">QR Code</div>
                  <p className="text-xs text-gray-500 mt-3">Após o pagamento, seu acesso é liberado automaticamente.</p>
                </div>
              )}
              {pagamento === 'cartao' && (
                <div className="space-y-3">
                  {[
                    { label: 'Número do cartão', placeholder: '0000 0000 0000 0000' },
                    { label: 'Nome no cartão', placeholder: 'JOÃO SILVA' },
                  ].map(f => (
                    <div key={f.label}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                      <input placeholder={f.placeholder} className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500" />
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Validade</label>
                      <input placeholder="MM/AA" className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">CVV</label>
                      <input placeholder="123" className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500" />
                    </div>
                  </div>
                </div>
              )}
              {erro && <p className="text-red-500 text-sm text-center">{erro}</p>}
            </div>
          )}

          {/* STEP 7 — Pronto */}
          {step === 7 && (
            <div className="text-center py-6">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5">
                <span className="text-4xl">🎉</span>
              </div>
              <h3 className="text-2xl font-black text-gray-900 mb-2">Bem-vindo ao Sistema Vargas!</h3>
              <p className="text-gray-500 mb-6">Sua conta foi criada. Verifique seu e-mail para confirmar o acesso e então entre no sistema.</p>
              <div className="bg-blue-50 rounded-xl p-4 mb-6 text-left space-y-2">
                <p className="text-sm text-blue-800 font-semibold">O que acontece agora:</p>
                <p className="text-xs text-blue-700">✓ Sua empresa foi cadastrada no sistema</p>
                <p className="text-xs text-blue-700">✓ Seu usuário administrador foi criado</p>
                <p className="text-xs text-blue-700">✓ Você tem 14 dias grátis para explorar tudo</p>
                <p className="text-xs text-blue-700">✓ Nosso time entrará em contato para auxiliar na implantação</p>
              </div>
              <a href="/dashboard" className="inline-block px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors">
                Entrar no Sistema →
              </a>
            </div>
          )}
        </div>

        {/* Footer */}
        {step < 7 && (
          <div className="flex items-center justify-between px-7 py-4 border-t border-gray-100 bg-gray-50">
            {step > 1 ? (
              <button onClick={() => setStep((step - 1) as Step)}
                className="px-5 py-2.5 border border-gray-300 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-100 transition-colors">
                ← Voltar
              </button>
            ) : <div />}
            {step < 6 ? (
              <button onClick={() => setStep((step + 1) as Step)}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-colors">
                Continuar →
              </button>
            ) : (
              <button onClick={finalizar} disabled={loading}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-60">
                {loading ? 'Processando...' : '✓ Finalizar Assinatura'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
