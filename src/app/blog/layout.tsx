import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Blog — Sistema Vargas',
  description: 'Novidades, atualizações e dicas do Sistema Vargas ERP.',
}

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white flex flex-col" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <nav className="sticky top-0 z-40 border-b border-gray-100/80" style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)' }}>
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)' }}>
              <span className="text-white font-black text-sm">V</span>
            </div>
            <span className="font-black text-gray-900 text-base tracking-tight">Vargas ERP</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm text-gray-600 hover:text-blue-600 transition-colors font-medium">← Voltar ao site</Link>
            <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">Entrar</Link>
          </div>
        </div>
      </nav>

      <main className="flex-1">{children}</main>

      <footer style={{ background: '#0f172a' }} className="text-white px-6 py-8">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-slate-500 text-xs">© 2026 Sistema Vargas ERP · Todos os direitos reservados</p>
          <Link href="/" className="text-slate-400 hover:text-white text-xs transition-colors">Voltar ao site</Link>
        </div>
      </footer>
    </div>
  )
}
