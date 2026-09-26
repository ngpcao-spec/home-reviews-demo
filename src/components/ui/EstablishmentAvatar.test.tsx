import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EstablishmentAvatar } from './EstablishmentAvatar'

describe('EstablishmentAvatar', () => {
  it('remplace une image en erreur par un fallback applicatif', () => {
    const { container } = render(<EstablishmentAvatar id="est-1" name="Le Petit Hanoi" photoUrl="/restaurants/missing.png" />)

    const image = container.querySelector('img')
    expect(image).not.toBeNull()
    expect(image).toHaveAttribute('src', '/restaurants/missing.png')
    fireEvent.error(image!)

    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Le Petit Hanoi')).toBeVisible()
  })
})
