import Link from 'next/link'
import { classesBotao, estiloPrimario } from '@/components/loja/ds'

// 404 da vitrine.
//
// Não herda o layout da loja de propósito: este arquivo também atende o caso
// em que a LOJA não foi resolvida (host desconhecido, loja desativada), e aí
// não existe cabeçalho, categoria nem cor de marca para renderizar.

export default function NaoEncontrado() {
  return (
    <div className="loja flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-semibold tracking-wide text-[var(--tinta-fraca)]">ERRO 404</p>
      <h1 className="text-2xl font-bold tracking-tight text-[var(--tinta-forte)]">
        Não encontramos esta página
      </h1>
      <p className="max-w-md text-[var(--tinta-media)]">
        O produto pode ter saído do catálogo, ou o endereço está incorreto.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Link href="/" className={classesBotao('primario')} style={estiloPrimario}>
          Ir para a loja
        </Link>
        <Link href="/buscar" className={classesBotao('secundario')}>
          Buscar produtos
        </Link>
      </div>
    </div>
  )
}
