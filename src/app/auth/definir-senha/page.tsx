'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Tela onde o usuário define a senha dele.
//
// Usada em dois momentos, com o mesmo código: quando alguém aceita um convite
// (o Supabase cria a conta SEM senha — sem esta tela, a pessoa entrava só
// naquela sessão e nunca mais conseguia logar) e quando alguém pede
// "esqueci minha senha" no login.
//
// Só funciona com uma sessão válida vinda do link do e-mail; sem isso não há
// o que atualizar, e a tela manda a pessoa pedir um link novo.

const MINIMO = 8

export default function DefinirSenhaPage() {
  const router = useRouter()
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [email, setEmail] = useState('')
  const [semSessao, setSemSessao] = useState(false)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setEmail(data.user.email ?? '')
      else setSemSessao(true)
    })
  }, [])

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    if (senha.length < MINIMO) { setErro(`A senha precisa ter pelo menos ${MINIMO} caracteres.`); return }
    if (senha !== confirmacao) { setErro('As duas senhas não são iguais.'); return }

    setSalvando(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: senha })
    if (error) {
      setErro(error.message === 'Auth session missing!'
        ? 'O link expirou. Peça um novo convite ou use "Esqueci minha senha" no login.'
        : 'Não foi possível salvar a senha: ' + error.message)
      setSalvando(false)
      return
    }
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">V</span>
            </div>
            <span className="text-white text-xl font-bold">Sistema Vargas</span>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          {semSessao ? (
            <>
              <h1 className="text-white font-semibold text-lg mb-2">Link expirado</h1>
              <p className="text-gray-400 text-sm mb-5">
                Esse link de acesso não vale mais. Peça ao administrador para reenviar o convite,
                ou use &quot;Esqueci minha senha&quot; na tela de login.
              </p>
              <a href="/login" className="block text-center w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors">
                Ir para o login
              </a>
            </>
          ) : (
            <>
              <h1 className="text-white font-semibold text-lg mb-1">Crie sua senha</h1>
              <p className="text-gray-400 text-sm mb-5">
                {email ? <>Você está definindo a senha de <strong className="text-gray-300">{email}</strong>. </> : null}
                É com ela que você vai entrar no sistema daqui pra frente.
              </p>

              <form onSubmit={salvar} className="space-y-4">
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">Nova senha</label>
                  <input type="password" value={senha} onChange={e => setSenha(e.target.value)} autoFocus
                    className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
                    placeholder={`Pelo menos ${MINIMO} caracteres`} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">Repita a senha</label>
                  <input type="password" value={confirmacao} onChange={e => setConfirmacao(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500" />
                </div>

                {erro && <p className="text-red-400 text-sm">{erro}</p>}

                <button type="submit" disabled={salvando}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors">
                  {salvando ? 'Salvando...' : 'Salvar senha e entrar'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
