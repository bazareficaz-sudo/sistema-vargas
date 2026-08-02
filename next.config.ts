import type { NextConfig } from "next";

// Cabeçalhos de segurança aplicados a toda resposta.
//
// São controles que qualquer avaliador externo consegue conferir sozinho, sem
// acesso ao código — basta abrir o site e olhar os cabeçalhos da resposta. Foi
// por isso que entraram: um questionário de segurança de parceiro (TikTok Shop)
// pediu evidência verificável, e afirmação sem evidência não vale nada.
//
// Deliberadamente NÃO tem Content-Security-Policy aqui. Uma CSP restritiva
// quebraria o app (scripts inline do Next, Supabase, imagens de marketplace) e
// uma CSP frouxa só finge proteger. Entra depois, medida com relatório em modo
// report-only antes de bloquear de verdade.
const SEGURANCA = [
  // Só HTTPS, por 1 ano, incluindo subdomínios. O navegador passa a recusar
  // http:// antes mesmo de sair da máquina do usuário.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },

  // O navegador respeita o Content-Type declarado em vez de adivinhar — fecha o
  // truque de subir um arquivo que "parece" imagem e é executado como script.
  { key: 'X-Content-Type-Options', value: 'nosniff' },

  // SAMEORIGIN e não DENY: o próprio sistema exibe PDF (comprovante, etiqueta,
  // DANFE) em iframe da mesma origem. DENY quebraria essas telas.
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },

  // A URL interna (que pode conter id de venda, de pedido, de cliente) não vaza
  // para site de terceiro em link de saída.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

  // Nenhuma tela do sistema usa câmera, microfone ou localização. Negar por
  // padrão evita que uma dependência futura peça sem ninguém perceber.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
]

const nextConfig: NextConfig = {
  // Não anunciar a tecnologia e a versão do servidor em toda resposta.
  poweredByHeader: false,

  async headers() {
    return [{ source: '/:path*', headers: SEGURANCA }]
  },
};

export default nextConfig;
