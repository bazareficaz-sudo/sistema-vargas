'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [avisoRecuperacao, setAvisoRecuperacao] = useState('')
  const [enviandoRecuperacao, setEnviandoRecuperacao] = useState(false)

  useEffect(() => {
    if (searchParams.get('erro') === 'acesso_bloqueado') {
      setErro('Seu acesso foi bloqueado ou inativado por um administrador.')
    }
  }, [searchParams])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setCarregando(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    if (error) {
      setErro('E-mail ou senha incorretos.')
      setCarregando(false)
      return
    }
    router.push('/dashboard')
    router.refresh()
  }

  // Recuperação de senha — também é o caminho de saída pra quem aceitou um
  // convite antes de existir a tela de definir senha e ficou sem senha nenhuma.
  async function recuperarSenha() {
    setErro(''); setAvisoRecuperacao('')
    if (!email.trim()) { setErro('Digite seu e-mail acima primeiro.'); return }
    setEnviandoRecuperacao(true)
    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/definir-senha`,
    })
    setEnviandoRecuperacao(false)
    if (error) { setErro('Não foi possível enviar o e-mail: ' + error.message); return }
    setAvisoRecuperacao('Enviamos um link para ' + email.trim() + '. Abra o e-mail e crie sua nova senha.')
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">V</span>
            </div>
            <span className="text-white text-xl font-bold">Sistema Vargas</span>
          </div>
          <p className="text-gray-400 text-sm">Gestão comercial inteligente</p>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h1 className="text-white font-semibold text-lg mb-5">Entrar na sua conta</h1>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="voce@empresa.com"
                required
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Senha</label>
              <input
                type="password"
                value={senha}
                onChange={e => setSenha(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600"
              />
            </div>

            {erro && (
              <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {erro}
              </p>
            )}

            {avisoRecuperacao && (
              <p className="text-emerald-400 text-sm bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-3 py-2">
                {avisoRecuperacao}
              </p>
            )}

            <button
              type="submit"
              disabled={carregando}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white font-medium rounded-lg py-2.5 text-sm transition-colors"
            >
              {carregando ? 'Entrando...' : 'Entrar'}
            </button>

            <button type="button" onClick={recuperarSenha} disabled={enviandoRecuperacao}
              className="w-full text-center text-gray-400 hover:text-gray-200 text-xs disabled:opacity-50">
              {enviandoRecuperacao ? 'Enviando...' : 'Esqueci minha senha'}
            </button>
          </form>
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          Sistema Vargas © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
