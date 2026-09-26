import { Store } from 'lucide-react'

const gradients = ['violet', 'coral', 'blue', 'mint']
export function EstablishmentAvatar({ name, id, large = false, photoUrl }: { name: string; id: string; large?: boolean; photoUrl?: string }) {
  if (photoUrl) return <img className={`est-avatar${large ? ' large' : ''}`} src={photoUrl} alt="" />
  const index = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % gradients.length
  return <div className={`est-avatar placeholder ${gradients[index]}${large ? ' large' : ''}`} aria-label={name}><Store /></div>
}
