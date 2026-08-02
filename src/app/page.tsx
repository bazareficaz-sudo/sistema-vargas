'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import SignupWizard from '@/components/landing/SignupWizard'

// ─── Animação no scroll ───────────────────────────────────────────────────────
function FadeIn({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [vis, setVis] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVis(true); obs.disconnect() } }, { threshold: 0.15 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return (
    <div ref={ref} className={className}
      style={{ opacity: vis ? 1 : 0, transform: vis ? 'translateY(0)' : 'translateY(28px)', transition: `opacity .6s ease ${delay}ms, transform .6s ease ${delay}ms` }}>
      {children}
    </div>
  )
}

// ─── Dados ────────────────────────────────────────────────────────────────────
const SEGMENTOS = [
  { icon: '🔧', label: 'Ferragens' }, { icon: '⚡', label: 'Material Elétrico' },
  { icon: '🧱', label: 'Construção' }, { icon: '🌾', label: 'Agropecuária' },
  { icon: '🚗', label: 'Autopeças' }, { icon: '📝', label: 'Papelaria' },
  { icon: '🏠', label: 'Utilidades' }, { icon: '🛒', label: 'Varejo em Geral' },
  { icon: '🥩', label: 'Açougue' }, { icon: '🍺', label: 'Distribuidora' },
]

const RECURSOS = [
  { icon: '🖥️', titulo: 'PDV Offline', desc: 'Continue vendendo mesmo sem internet. Sincronização automática quando a conexão voltar.', cor: 'from-blue-500 to-indigo-600' },
  { icon: '📦', titulo: 'Estoque Inteligente', desc: 'Controle por depósitos, transferências, inventário e sugestão automática de reposição.', cor: 'from-amber-500 to-orange-600' },
  { icon: '🏢', titulo: 'Multiempresa', desc: 'Gerencie vários CNPJs em um único login. Compartilhe produtos e controle financeiro separado.', cor: 'from-violet-500 to-purple-600' },
  { icon: '💬', titulo: 'WhatsApp Integrado', desc: 'Envie orçamentos, cobranças, pós-venda e campanhas diretamente pelo sistema via Z-API.', cor: 'from-emerald-500 to-teal-600' },
  { icon: '🏪', titulo: 'Marketplaces', desc: 'Integrado com Mercado Livre, Shopee, Amazon, Magalu, TikTok Shop e Nuvemshop.', cor: 'from-pink-500 to-rose-600' },
  { icon: '💰', titulo: 'Financeiro Completo', desc: 'Fluxo de caixa, contas a pagar e receber, PIX, conciliação e cobrança automática.', cor: 'from-emerald-600 to-green-700' },
  { icon: '📥', titulo: 'Compras / XML', desc: 'Importação de NF-e via XML, manifestação do destinatário e sugestão inteligente de compra.', cor: 'from-orange-500 to-red-600' },
  { icon: '📊', titulo: 'Relatórios & BI', desc: 'Mais de 100 indicadores: Curva ABC, RFM de clientes, fluxo financeiro, alertas automáticos.', cor: 'from-sky-500 to-blue-600' },
]

const PLANOS = [
  {
    id: 'starter', nome: 'Starter', preco: 97, periodo: '/mês',
    desc: 'Para quem está começando', destaque: false,
    recursos: ['1 empresa', 'Até 3 usuários', 'PDV', 'Controle de Estoque', 'Financeiro básico', 'WhatsApp integrado', 'Suporte por chat'],
  },
  {
    id: 'professional', nome: 'Professional', preco: 197, periodo: '/mês',
    desc: 'O mais escolhido', destaque: true,
    recursos: ['Até 3 empresas', 'Até 10 usuários', 'Tudo do Starter', 'PDV Offline desktop', 'Marketplaces', 'Importação XML / NF-e', 'Relatórios & BI completo', 'Multiempresa nativo'],
  },
  {
    id: 'enterprise', nome: 'Enterprise', preco: 397, periodo: '/mês',
    desc: 'Para grandes operações', destaque: false,
    recursos: ['Empresas ilimitadas', 'Usuários ilimitados', 'Tudo do Professional', 'API aberta', 'Integrações personalizadas', 'Suporte prioritário', 'Implantação assistida'],
  },
]

const FAQS = [
  { q: 'O sistema funciona offline?', r: 'Sim! O PDV Desktop continua funcionando normalmente sem internet. Todas as vendas são salvas localmente e sincronizadas automaticamente quando a conexão voltar.' },
  { q: 'Posso ter mais de uma empresa?', r: 'Sim. A partir do plano Professional você pode gerenciar até 3 CNPJs em um único login. No Enterprise, empresas ilimitadas.' },
  { q: 'Tem integração com Mercado Livre e Shopee?', r: 'Sim! A partir do plano Professional você pode integrar com Mercado Livre, Shopee, Amazon, Magalu, TikTok Shop e Nuvemshop.' },
  { q: 'Possui emissão de NF-e e NFC-e?', r: 'Sim. O módulo fiscal permite emissão de NF-e, NFC-e, importação de XML e manifestação do destinatário.' },
  { q: 'Como funciona o suporte?', r: 'Suporte via chat e WhatsApp em todos os planos. Suporte prioritário por telefone no Enterprise. Todos os planos incluem base de conhecimento e vídeos de treinamento.' },
  { q: 'Existe fidelidade ou contrato mínimo?', r: 'Não. Você pode cancelar quando quiser, sem multas. Os 14 dias de teste não requerem cartão de crédito.' },
  { q: 'Posso importar meus produtos do Excel?', r: 'Sim! O sistema aceita importação de produtos por planilha Excel/CSV, além de importação automática via XML de NF-e de entrada.' },
  { q: 'Tem aplicativo para celular?', r: 'O sistema é 100% web responsivo e funciona em qualquer navegador do celular ou tablet. Além disso, o PDV desktop pode ser instalado no computador da loja.' },
]

const DEPOIMENTOS = [
  { nome: 'Roberto Alves', empresa: 'Alves Ferragens — MG', foto: '👨‍💼', nota: 5, texto: 'Antes eu usava 3 sistemas separados. Hoje faço tudo em um lugar só. O PDV Offline salvou minha vida quando a internet caiu no meio do mês de maior movimento.' },
  { nome: 'Ana Paula Costa', empresa: 'Agropecuária São João — SP', foto: '👩‍💼', nota: 5, texto: 'A integração com o WhatsApp mudou completamente meu pós-venda. Hoje os clientes recebem o orçamento na hora pelo celular e fecham no mesmo dia.' },
  { nome: 'Marcos Freitas', empresa: 'Distribuidora Freitas — PR', foto: '🧑‍💼', nota: 5, texto: 'Tenho 4 empresas e gerir tudo separado era um pesadelo. Com o Vargas ERP entro com um único login e vejo tudo consolidado. A Curva ABC me mostrou onde eu estava perdendo dinheiro.' },
]

const COMPARATIVO = [
  { item: 'PDV Offline nativo', vargas: true, outros: false },
  { item: 'Multiempresa nativo', vargas: true, outros: false },
  { item: 'WhatsApp integrado', vargas: true, outros: false },
  { item: 'Curva ABC automática', vargas: true, outros: false },
  { item: 'Alertas inteligentes de estoque', vargas: true, outros: false },
  { item: 'Importação XML de NF-e', vargas: true, outros: true },
  { item: 'Integração Marketplace', vargas: true, outros: true },
  { item: 'Suporte em português', vargas: true, outros: true },
  { item: 'Sem fidelidade', vargas: true, outros: false },
  { item: 'Implantação simples', vargas: true, outros: false },
]

// ─── Calculadora ──────────────────────────────────────────────────────────────
function PlanCalculator({ onAssinar }: { onAssinar: (plano: string) => void }) {
  const [empresas, setEmpresas] = useState(1)
  const [usuarios, setUsuarios] = useState(3)
  const [marketplace, setMarketplace] = useState(false)
  const [pdvOffline, setPdvOffline] = useState(false)

  const plano = empresas > 3 || usuarios > 10 ? 'enterprise'
    : empresas > 1 || usuarios > 3 || marketplace || pdvOffline ? 'professional'
    : 'starter'

  const precos: Record<string, number> = { starter: 97, professional: 197, enterprise: 397 }
  const nomes: Record<string, string> = { starter: 'Starter', professional: 'Professional', enterprise: 'Enterprise' }

  return (
    <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 max-w-xl mx-auto">
      <h3 className="text-xl font-bold text-gray-900 mb-6">Calculadora de Plano</h3>
      <div className="space-y-5">
        {[
          { label: `Número de empresas: ${empresas}`, val: empresas, set: setEmpresas, min: 1, max: 20 },
          { label: `Número de usuários: ${usuarios}`, val: usuarios, set: setUsuarios, min: 1, max: 50 },
        ].map(f => (
          <div key={f.label}>
            <div className="flex justify-between text-sm text-gray-600 mb-1.5">
              <span>{f.label}</span>
            </div>
            <input type="range" min={f.min} max={f.max} value={f.val} onChange={e => f.set(Number(e.target.value))}
              className="w-full accent-blue-600 h-2" />
          </div>
        ))}
        <div className="space-y-2">
          {[
            { label: 'Preciso de Marketplaces (ML, Shopee...)', val: marketplace, set: setMarketplace },
            { label: 'Preciso de PDV Offline no computador', val: pdvOffline, set: setPdvOffline },
          ].map(opt => (
            <label key={opt.label} className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={opt.val} onChange={e => opt.set(e.target.checked)} className="w-4 h-4 accent-blue-600" />
              <span className="text-sm text-gray-700">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="mt-6 bg-blue-50 rounded-2xl p-5 text-center">
        <p className="text-sm text-gray-500">Plano recomendado</p>
        <p className="text-3xl font-black text-blue-600 mt-1">{nomes[plano]}</p>
        <p className="text-4xl font-black text-gray-900 mt-1">R$ {precos[plano]}<span className="text-base text-gray-400 font-normal">/mês</span></p>
        <button onClick={() => onAssinar(plano)}
          className="mt-4 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors">
          Assinar {nomes[plano]} →
        </button>
      </div>
    </div>
  )
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────
function FAQ() {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div className="space-y-3 max-w-3xl mx-auto">
      {FAQS.map((faq, i) => (
        <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          <button onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between px-6 py-4 text-left">
            <span className="font-semibold text-gray-900 text-sm">{faq.q}</span>
            <span className={`text-gray-400 transition-transform flex-shrink-0 ml-4 ${open === i ? 'rotate-180' : ''}`} style={{ fontSize: 20 }}>⌄</span>
          </button>
          {open === i && (
            <div className="px-6 pb-4">
              <p className="text-sm text-gray-600 leading-relaxed">{faq.r}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Mock do sistema ──────────────────────────────────────────────────────────
function SystemMockup() {
  return (
    <div className="relative">
      {/* Notebook */}
      <div className="rounded-2xl overflow-hidden shadow-2xl border border-white/20" style={{ background: '#0f172a' }}>
        {/* Barra do sistema */}
        <div className="flex items-center gap-1.5 px-4 py-2.5" style={{ background: '#1e293b' }}>
          <div className="w-3 h-3 rounded-full bg-red-500/60" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
          <div className="w-3 h-3 rounded-full bg-emerald-500/60" />
          <div className="flex-1 mx-4 bg-white/10 rounded text-[10px] text-white/40 px-3 py-1 text-center">Sistema Vargas ERP</div>
        </div>
        {/* Conteúdo do mock */}
        <div className="flex" style={{ height: 280 }}>
          {/* Sidebar mini */}
          <div className="w-14 flex flex-col items-center py-4 gap-3" style={{ background: '#0f172a' }}>
            {['⊞','🛒','📦','💰','📊'].map((icon, i) => (
              <div key={i} className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${i === 0 ? 'bg-blue-600' : 'bg-white/5 text-white/30'}`}>
                {icon}
              </div>
            ))}
          </div>
          {/* Dashboard fake */}
          <div className="flex-1 p-4 overflow-hidden">
            <p className="text-white/60 text-xs mb-3">Dashboard — hoje</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {[
                { label: 'Vendas hoje', val: 'R$ 4.872', cor: '#3b82f6' },
                { label: 'Ticket médio', val: 'R$ 142', cor: '#10b981' },
                { label: 'Estoque', val: '1.247 itens', cor: '#8b5cf6' },
                { label: 'A receber', val: 'R$ 12.400', cor: '#f59e0b' },
              ].map(card => (
                <div key={card.label} className="rounded-xl p-2.5" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>{card.label}</p>
                  <p className="font-bold text-white mt-0.5" style={{ fontSize: 13, color: card.cor }}>{card.val}</p>
                </div>
              ))}
            </div>
            {/* Mini gráfico de barras */}
            <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }} className="mb-2">Faturamento 7 dias</p>
              <div className="flex items-end gap-1 h-12">
                {[40, 65, 45, 80, 55, 95, 70].map((h, i) => (
                  <div key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, background: i === 5 ? '#3b82f6' : 'rgba(59,130,246,0.3)' }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Badge PDV Offline flutuante */}
      <div className="absolute -bottom-4 -left-4 bg-white rounded-2xl shadow-xl border border-gray-100 px-4 py-3 flex items-center gap-2.5">
        <div className="w-8 h-8 bg-emerald-100 rounded-xl flex items-center justify-center">
          <span className="text-sm">🖥️</span>
        </div>
        <div>
          <p className="text-xs font-bold text-gray-900">PDV Offline</p>
          <p className="text-[10px] text-emerald-600">● Funcionando sem internet</p>
        </div>
      </div>

      {/* Badge sincronização flutuante */}
      <div className="absolute -top-4 -right-4 bg-white rounded-2xl shadow-xl border border-gray-100 px-4 py-3 flex items-center gap-2.5">
        <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center">
          <span className="text-sm">🔄</span>
        </div>
        <div>
          <p className="text-xs font-bold text-gray-900">Sincronizado</p>
          <p className="text-[10px] text-blue-600">Agora mesmo</p>
        </div>
      </div>
    </div>
  )
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [wizard, setWizard] = useState(false)
  const [wizardPlano, setWizardPlano] = useState<string | undefined>()

  function abrirWizard(plano?: string) { setWizardPlano(plano); setWizard(true) }

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── NAV ─────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-40 border-b border-gray-100/80" style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)' }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)' }}>
              <span className="text-white font-black text-sm">V</span>
            </div>
            <span className="font-black text-gray-900 text-base tracking-tight">Vargas ERP</span>
          </div>
          <div className="hidden md:flex items-center gap-6">
            {[['#recursos','Recursos'],['#planos','Planos'],['#faq','FAQ']].map(([h, l]) => (
              <a key={h} href={h} className="text-sm text-gray-600 hover:text-blue-600 transition-colors font-medium">{l}</a>
            ))}
            <Link href="/blog" className="text-sm text-gray-600 hover:text-blue-600 transition-colors font-medium">Blog</Link>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">Entrar</Link>
            <button onClick={() => abrirWizard()}
              className="px-4 py-2 text-sm font-bold text-white rounded-lg transition-colors"
              style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)' }}>
              Teste Grátis
            </button>
          </div>
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────────────────────── */}
      <section className="pt-28 pb-20 px-6 overflow-hidden" style={{ background: 'linear-gradient(135deg,#f8faff 0%,#eef2ff 50%,#f0fdf4 100%)' }}>
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 text-xs font-bold px-3 py-1.5 rounded-full mb-5">
                🚀 Mais de 500 empresas já usam
              </div>
              <h1 className="text-4xl lg:text-5xl font-black text-gray-900 leading-tight mb-5" style={{ letterSpacing: '-0.02em' }}>
                Gerencie toda sua<br />
                <span style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  empresa em um<br />único sistema.
                </span>
              </h1>
              <p className="text-lg text-gray-500 mb-8 leading-relaxed">
                Controle vendas, estoque, financeiro, <strong className="text-gray-700">PDV Offline</strong>, WhatsApp e Marketplaces em uma única plataforma simples e poderosa.
              </p>
              <div className="flex flex-wrap gap-3 mb-8">
                <button onClick={() => abrirWizard()}
                  className="px-7 py-3.5 text-white font-bold rounded-xl text-sm transition-all hover:scale-105 shadow-lg shadow-blue-200"
                  style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)' }}>
                  Teste Gratuitamente — 14 dias
                </button>
                <a href="https://wa.me/5500000000000" target="_blank"
                  className="px-7 py-3.5 bg-white text-gray-700 font-bold rounded-xl text-sm border border-gray-200 hover:border-gray-300 transition-all shadow-sm">
                  📅 Agendar Demo
                </a>
              </div>
              {/* Selos */}
              <div className="flex flex-wrap gap-2">
                {['✓ Multiempresa','✓ PDV Offline','✓ Marketplace','✓ WhatsApp','✓ NF-e / NFC-e','✓ Suporte BR'].map(s => (
                  <span key={s} className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full font-medium">{s}</span>
                ))}
              </div>
            </div>
            <div className="relative">
              <SystemMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ── SEGMENTOS ───────────────────────────────────────────────────── */}
      <section className="py-16 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <FadeIn>
            <p className="text-center text-sm font-semibold text-gray-400 uppercase tracking-widest mb-8">Feito para o comércio brasileiro</p>
          </FadeIn>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {SEGMENTOS.map((s, i) => (
              <FadeIn key={s.label} delay={i * 40}>
                <div className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 transition-all cursor-default">
                  <span className="text-3xl">{s.icon}</span>
                  <span className="text-xs font-semibold text-gray-700 text-center">{s.label}</span>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── RECURSOS ────────────────────────────────────────────────────── */}
      <section id="recursos" className="py-20 px-6" style={{ background: '#f8faff' }}>
        <div className="max-w-7xl mx-auto">
          <FadeIn>
            <div className="text-center mb-14">
              <p className="text-sm font-bold text-blue-600 uppercase tracking-widest mb-3">Tudo que você precisa</p>
              <h2 className="text-3xl lg:text-4xl font-black text-gray-900">Uma plataforma.<br />Infinitas possibilidades.</h2>
            </div>
          </FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {RECURSOS.map((r, i) => (
              <FadeIn key={r.titulo} delay={i * 60}>
                <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-shadow group">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-4 bg-gradient-to-br ${r.cor}`}>
                    {r.icon}
                  </div>
                  <h3 className="font-bold text-gray-900 mb-2">{r.titulo}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{r.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── PDV OFFLINE DESTAQUE ─────────────────────────────────────────── */}
      <section className="py-20 px-6 bg-gray-900 text-white overflow-hidden relative">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, #3b82f6 0%, transparent 60%),radial-gradient(circle at 70% 50%, #6366f1 0%, transparent 60%)' }} />
        <div className="max-w-7xl mx-auto relative">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <p className="text-sm font-bold text-blue-400 uppercase tracking-widest mb-3">Diferencial exclusivo</p>
              <h2 className="text-3xl lg:text-4xl font-black mb-5 leading-tight">Nunca pare<br />de vender.</h2>
              <p className="text-gray-300 text-lg mb-6 leading-relaxed">
                Mesmo sem internet, seu caixa continua funcionando normalmente. O sistema salva tudo localmente e sincroniza automaticamente quando a conexão voltar.
              </p>
              <div className="space-y-3">
                {[
                  'PDV Desktop instalado no computador da loja',
                  'Vendas, estoque e caixa funcionam 100% offline',
                  'Sincronização automática ao reconectar',
                  'Histórico completo preservado sem perdas',
                ].map(t => (
                  <div key={t} className="flex items-start gap-3">
                    <span className="text-emerald-400 mt-0.5 flex-shrink-0">✓</span>
                    <span className="text-gray-300 text-sm">{t}</span>
                  </div>
                ))}
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              {/* Fluxograma PDV Offline */}
              <div className="flex flex-col items-center gap-2">
                {[
                  { icon: '☁️', label: 'ERP na nuvem', cor: '#3b82f6' },
                  { icon: '🔄', label: 'Sincronização automática', cor: '#8b5cf6', small: true },
                  { icon: '🖥️', label: 'PDV Desktop', cor: '#10b981' },
                  { icon: '📡', label: 'Internet caiu', cor: '#ef4444', small: true },
                  { icon: '✅', label: 'Venda continua normalmente', cor: '#f59e0b' },
                  { icon: '🔄', label: 'Internet voltou — sincroniza', cor: '#10b981', small: true },
                ].map((item, i) => (
                  <div key={i} className="flex flex-col items-center">
                    <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl ${item.small ? 'opacity-70' : ''}`}
                      style={{ background: `${item.cor}20`, border: `1px solid ${item.cor}40` }}>
                      <span className="text-xl">{item.icon}</span>
                      <span className="text-sm font-medium" style={{ color: item.cor }}>{item.label}</span>
                    </div>
                    {i < 5 && <div className="w-0.5 h-4 bg-white/10 my-1" />}
                  </div>
                ))}
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ── COMO FUNCIONA ────────────────────────────────────────────────── */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="text-center mb-14">
              <p className="text-sm font-bold text-blue-600 uppercase tracking-widest mb-3">Simples assim</p>
              <h2 className="text-3xl lg:text-4xl font-black text-gray-900">Comece a vender<br />em 5 passos</h2>
            </div>
          </FadeIn>
          <div className="flex flex-col md:flex-row gap-0">
            {[
              { num: '01', titulo: 'Escolha seu plano', desc: 'Starter, Professional ou Enterprise. Todos com 14 dias grátis.' },
              { num: '02', titulo: 'Cadastre sua empresa', desc: 'Digite o CNPJ e preenchemos tudo automaticamente pela Receita Federal.' },
              { num: '03', titulo: 'Importe seus produtos', desc: 'Via Excel, código de barras ou XML de NF-e de entrada.' },
              { num: '04', titulo: 'Configure seu PDV', desc: 'Instale o app no computador da loja ou use diretamente no navegador.' },
              { num: '05', titulo: 'Comece a vender', desc: 'Seu time já pode atender clientes, controlar estoque e fechar o caixa.' },
            ].map((s, i) => (
              <FadeIn key={s.num} delay={i * 80} className="flex-1 flex flex-col md:flex-row items-start">
                <div className="flex md:flex-col items-center md:items-center">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center font-black text-sm text-white flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)' }}>
                    {s.num}
                  </div>
                  {i < 4 && <div className="flex-1 md:flex-none h-0.5 md:h-12 md:w-0.5 bg-gray-200 mx-2 md:mx-0 md:my-2" />}
                </div>
                <div className="ml-4 md:ml-0 md:mt-4 pb-6 md:pb-0 md:px-4">
                  <h3 className="font-bold text-gray-900 text-sm mb-1">{s.titulo}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">{s.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── CALCULADORA ──────────────────────────────────────────────────── */}
      <section className="py-20 px-6" style={{ background: '#f8faff' }}>
        <div className="max-w-7xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12">
              <p className="text-sm font-bold text-blue-600 uppercase tracking-widest mb-3">Quanto vai custar?</p>
              <h2 className="text-3xl font-black text-gray-900">Descubra o plano ideal<br />para seu negócio</h2>
            </div>
          </FadeIn>
          <FadeIn delay={100}>
            <PlanCalculator onAssinar={plano => abrirWizard(plano)} />
          </FadeIn>
        </div>
      </section>

      {/* ── PLANOS ───────────────────────────────────────────────────────── */}
      <section id="planos" className="py-20 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <FadeIn>
            <div className="text-center mb-14">
              <p className="text-sm font-bold text-blue-600 uppercase tracking-widest mb-3">Preços transparentes</p>
              <h2 className="text-3xl lg:text-4xl font-black text-gray-900">Planos para todo tipo<br />de empresa</h2>
              <p className="text-gray-500 mt-3">14 dias grátis · Sem cartão · Cancele quando quiser</p>
            </div>
          </FadeIn>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {PLANOS.map((p, i) => (
              <FadeIn key={p.id} delay={i * 80}>
                <div className={`rounded-3xl p-8 flex flex-col ${p.destaque ? 'text-white shadow-2xl scale-105 relative' : 'bg-white border border-gray-100 shadow-sm'}`}
                  style={p.destaque ? { background: 'linear-gradient(135deg,#1e40af,#4f46e5)' } : {}}>
                  {p.destaque && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="bg-yellow-400 text-yellow-900 text-xs font-black px-4 py-1 rounded-full shadow">MAIS POPULAR</span>
                    </div>
                  )}
                  <div className="mb-6">
                    <h3 className={`text-xl font-black mb-1 ${p.destaque ? 'text-white' : 'text-gray-900'}`}>{p.nome}</h3>
                    <p className={`text-sm ${p.destaque ? 'text-blue-200' : 'text-gray-400'}`}>{p.desc}</p>
                  </div>
                  <div className="mb-6">
                    <span className={`text-5xl font-black ${p.destaque ? 'text-white' : 'text-gray-900'}`}>R$ {p.preco}</span>
                    <span className={`text-sm ml-1 ${p.destaque ? 'text-blue-200' : 'text-gray-400'}`}>/mês</span>
                  </div>
                  <ul className="space-y-2.5 mb-8 flex-1">
                    {p.recursos.map(r => (
                      <li key={r} className="flex items-start gap-2.5 text-sm">
                        <span className={`mt-0.5 flex-shrink-0 ${p.destaque ? 'text-blue-300' : 'text-emerald-500'}`}>✓</span>
                        <span className={p.destaque ? 'text-blue-100' : 'text-gray-600'}>{r}</span>
                      </li>
                    ))}
                  </ul>
                  <button onClick={() => abrirWizard(p.id)}
                    className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all ${p.destaque ? 'bg-white text-blue-700 hover:bg-blue-50' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                    Assinar {p.nome} →
                  </button>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMPARATIVO ──────────────────────────────────────────────────── */}
      <section className="py-20 px-6" style={{ background: '#f8faff' }}>
        <div className="max-w-3xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12">
              <p className="text-sm font-bold text-blue-600 uppercase tracking-widest mb-3">Por que o Vargas ERP?</p>
              <h2 className="text-3xl font-black text-gray-900">Compare e decida</h2>
            </div>
          </FadeIn>
          <FadeIn delay={100}>
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="grid grid-cols-3 bg-gray-50 border-b border-gray-100">
                <div className="px-6 py-4 text-sm font-semibold text-gray-500">Recurso</div>
                <div className="px-6 py-4 text-sm font-bold text-blue-600 text-center">Vargas ERP</div>
                <div className="px-6 py-4 text-sm font-semibold text-gray-400 text-center">Outros ERPs</div>
              </div>
              {COMPARATIVO.map((row, i) => (
                <div key={i} className={`grid grid-cols-3 border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                  <div className="px-6 py-3.5 text-sm text-gray-700">{row.item}</div>
                  <div className="px-6 py-3.5 text-center text-emerald-500 font-bold">✓</div>
                  <div className="px-6 py-3.5 text-center">
                    {row.outros ? <span className="text-gray-400 text-sm">✓</span> : <span className="text-red-400 font-bold">✗</span>}
                  </div>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── DEPOIMENTOS ──────────────────────────────────────────────────── */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12">
              <p className="text-sm font-bold text-blue-600 uppercase tracking-widest mb-3">Casos de sucesso</p>
              <h2 className="text-3xl font-black text-gray-900">Quem usa, recomenda</h2>
            </div>
          </FadeIn>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {DEPOIMENTOS.map((d, i) => (
              <FadeIn key={d.nome} delay={i * 80}>
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-7 flex flex-col gap-4">
                  <div className="flex gap-0.5">{'★★★★★'.split('').map((s, i) => <span key={i} className="text-yellow-400">{s}</span>)}</div>
                  <p className="text-gray-600 text-sm leading-relaxed flex-1">"{d.texto}"</p>
                  <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                    <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center text-xl">{d.foto}</div>
                    <div>
                      <p className="font-bold text-gray-900 text-sm">{d.nome}</p>
                      <p className="text-xs text-gray-400">{d.empresa}</p>
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section id="faq" className="py-20 px-6" style={{ background: '#f8faff' }}>
        <div className="max-w-7xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12">
              <p className="text-sm font-bold text-blue-600 uppercase tracking-widest mb-3">Dúvidas frequentes</p>
              <h2 className="text-3xl font-black text-gray-900">Perguntas e Respostas</h2>
            </div>
          </FadeIn>
          <FAQ />
        </div>
      </section>

      {/* ── CTA FINAL ───────────────────────────────────────────────────── */}
      <section className="py-24 px-6 text-white text-center" style={{ background: 'linear-gradient(135deg,#1e3a8a 0%,#312e81 50%,#4c1d95 100%)' }}>
        <FadeIn>
          <p className="text-sm font-bold text-blue-300 uppercase tracking-widest mb-4">Chegou a hora</p>
          <h2 className="text-3xl lg:text-4xl font-black mb-5 max-w-3xl mx-auto leading-tight">
            Pare de perder tempo com vários sistemas. Gerencie <span className="text-yellow-400">tudo em um único lugar.</span>
          </h2>
          <p className="text-blue-200 mb-8 text-lg max-w-xl mx-auto">
            Vendas, estoque, financeiro, PDV Offline, WhatsApp e Marketplaces — integrados e prontos para usar hoje.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <button onClick={() => abrirWizard()}
              className="px-8 py-4 bg-yellow-400 hover:bg-yellow-300 text-yellow-900 font-black rounded-xl text-base transition-all hover:scale-105 shadow-xl">
              🚀 Começar Agora — Grátis por 14 dias
            </button>
            <a href="https://wa.me/5500000000000" target="_blank"
              className="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl text-base transition-colors border border-white/20">
              📅 Solicitar Demonstração
            </a>
          </div>
          <p className="text-blue-300 text-sm mt-5">Sem cartão de crédito · Sem fidelidade · Cancele quando quiser</p>
        </FadeIn>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────── */}
      <footer style={{ background: '#0f172a' }} className="text-white px-6 py-12">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)' }}>
                  <span className="text-white font-black text-sm">V</span>
                </div>
                <span className="font-black text-white">Vargas ERP</span>
              </div>
              <p className="text-slate-400 text-xs leading-relaxed">ERP completo para o comércio varejista brasileiro. PDV Offline, multiempresa, marketplaces e WhatsApp integrados.</p>
            </div>
            {[
              { titulo: 'Produto', links: ['Recursos', 'Planos', 'PDV Offline', 'Marketplaces', 'WhatsApp'] },
              { titulo: 'Empresa', links: ['Sobre nós', 'Blog', 'Contato', 'Suporte', 'Status'] },
              { titulo: 'Legal', links: ['Privacidade', 'Termos de Uso', 'LGPD', 'Cookies'] },
            ].map(col => (
              <div key={col.titulo}>
                <p className="font-bold text-white text-sm mb-4">{col.titulo}</p>
                <ul className="space-y-2">
                  {col.links.map(l => {
                    // Os itens legais apontam para a página de Privacidade, cada um
                    // na seção que responde a pergunta que o nome do link faz.
                    // "Termos de Uso" continua sem destino: é outro documento, e
                    // apontá-lo para a Privacidade seria repetir o erro que fez o
                    // questionário de segurança da TikTok ser recusado.
                    const destino: Record<string, string> = {
                      Blog: '/blog',
                      Privacidade: '/privacidade',
                      LGPD: '/privacidade#direitos',
                      Cookies: '/privacidade#cookies',
                    }
                    const href = destino[l]
                    return (
                      <li key={l}>
                        {href ? (
                          <Link href={href} className="text-slate-400 text-xs hover:text-white transition-colors">{l}</Link>
                        ) : (
                          <span className="text-slate-500 text-xs">{l}</span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
          <div className="border-t border-white/10 pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-slate-500 text-xs">© 2025 Sistema Vargas ERP · Todos os direitos reservados</p>
            <div className="flex gap-4">
              {['WhatsApp', 'Instagram', 'LinkedIn', 'YouTube'].map(s => (
                <a key={s} href="#" className="text-slate-500 hover:text-white text-xs transition-colors">{s}</a>
              ))}
            </div>
          </div>
        </div>
      </footer>

      {/* ── WIZARD ──────────────────────────────────────────────────────── */}
      {wizard && <SignupWizard onClose={() => setWizard(false)} planoInicial={wizardPlano} />}
    </div>
  )
}
