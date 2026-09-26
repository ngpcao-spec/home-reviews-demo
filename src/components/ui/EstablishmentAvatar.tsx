import { Store } from 'lucide-react'
import { useState } from 'react'

const gradients = ['violet', 'coral', 'blue', 'mint']
export function EstablishmentAvatar({ name, id, large = false, photoUrl }: { name: string; id: string; large?: boolean; photoUrl?: string }) {
  const index = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % gradients.length
  const [failedUrl, setFailedUrl] = useState<string>()
  const resolvedPhotoUrl = photoUrl?.startsWith('/') ? `${import.meta.env.BASE_URL}${photoUrl.replace(/^\/+/, '')}` : photoUrl

  if (resolvedPhotoUrl && failedUrl !== resolvedPhotoUrl) {
    return <img className={`est-avatar${large ? ' large' : ''}`} src={resolvedPhotoUrl} alt="" onError={() => setFailedUrl(resolvedPhotoUrl)} />
  }
  return <div className={`est-avatar placeholder ${gradients[index]}${large ? ' large' : ''}`} aria-label={name}><Store /></div>
}
