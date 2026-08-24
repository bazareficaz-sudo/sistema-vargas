import Link from 'next/link'
import type { Loja } from '@/lib/commerce/tipos'
import type { Categoria } from '@/lib/commerce/tipos'

// Rodapé. Server component: nada aqui muda depois de renderizado.
//
// Mostra só o que a loja realmente preencheu. Rodapé com "Política de trocas"
// que leva a lugar nenhum, ou telefone em branco, é pior que rodapé curto —
// é a primeira coisa que faz um site parecer abandonado.

function soDigitos(v: string) { return v.replace(/\D/g, '') }

export default function Rodape({ loja, categorias }: { loja: Loja; categorias: Categoria[] }) {
  const zap = loja.whatsapp ? soDigitos(loja.whatsapp) : null
  const temContato = !!(zap || loja.telefone || loja.email)
  const redes = [
    loja.instagram && { nome: 'Instagram', url: loja.instagram },
    loja.facebook && { nome: 'Facebook', url: loja.facebook },
    loja.tiktok && { nome: 'TikTok', url: loja.tiktok },
  ].filter(Boolean) as { nome: string; url: string }[]

  return (
    <footer className="mt-16 border-t border-[var(--borda)] bg-[var(--fundo-suave)]">
      <div className="loja-container py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <h3 className="text-base font-bold text-[var(--tinta-forte)]">{loja.nome}</h3>
            {loja.descricao && (
              <p className="mt-2 text-sm leading-relaxed text-[var(--tinta-media)]">{loja.descricao}</p>
            )}
            {(loja.cidade || loja.uf) && (
              <p className="mt-2 text-sm text-[var(--tinta-media)]">
                {[loja.cidade, loja.uf].filter(Boolean).join(' — ')}
              </p>
            )}
          </div>

          {categorias.length > 0 && (
            <nav aria-label="Categorias do rodapé">
              <h3 className="text-sm font-semibold text-[var(--tinta-forte)]">Categorias</h3>
              <ul className="mt-3 space-y-2">
                {categorias.slice(0, 6).map(c => (
                  <li key={c.id}>
                    <Link href={`/c/${c.slug}`} className="text-sm text-[var(--tinta-media)] hover:text-[var(--tinta-forte)]">
                      {c.nome}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          {temContato && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--tinta-forte)]">Atendimento</h3>
              <ul className="mt-3 space-y-2 text-sm text-[var(--tinta-media)]">
                {zap && (
                  <li>
                    <a
                      href={`https://wa.me/55${zap}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium hover:text-[var(--tinta-forte)]"
                    >
                      WhatsApp {loja.whatsapp}
                    </a>
                  </li>
                )}
                {loja.telefone && <li>{loja.telefone}</li>}
                {loja.email && (
                  <li><a href={`mailto:${loja.email}`} className="hover:text-[var(--tinta-forte)]">{loja.email}</a></li>
                )}
                {loja.horarioAtendimento && <li className="pt-1">{loja.horarioAtendimento}</li>}
              </ul>
            </div>
          )}

          {redes.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--tinta-forte)]">Redes</h3>
              <ul className="mt-3 space-y-2">
                {redes.map(r => (
                  <li key={r.nome}>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-[var(--tinta-media)] hover:text-[var(--tinta-forte)]"
                    >
                      {r.nome}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <p className="mt-10 border-t border-[var(--borda)] pt-6 text-xs text-[var(--tinta-fraca)]">
          © {new Date().getFullYear()} {loja.nome}. Preços e disponibilidade sujeitos a alteração.
        </p>
      </div>
    </footer>
  )
}
