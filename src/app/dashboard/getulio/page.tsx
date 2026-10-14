import { redirect } from 'next/navigation'

// A assistente passou a se chamar Betina; o endereço antigo (favoritos,
// links em mensagens já enviadas) continua chegando na Central.
export default function CentralAntiga() {
  redirect('/dashboard/betina')
}
