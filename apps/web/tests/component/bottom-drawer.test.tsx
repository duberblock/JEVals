import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BottomDrawer } from '../../components/principal/bottom-drawer'

describe('BottomDrawer', () => {
  it('renders the trigger and opens the sheet from the bottom on tap', async () => {
    render(
      <BottomDrawer label="Open detail" title="Questions detected" closeLabel="Close">
        <p>Drawer body content</p>
      </BottomDrawer>
    )

    expect(screen.queryByText('Drawer body content')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open detail' }))

    expect(await screen.findByText('Drawer body content')).toBeInTheDocument()
    expect(screen.getByText('Questions detected')).toBeInTheDocument()
  })

  it('closes with the close control', async () => {
    render(
      <BottomDrawer label="Open detail" title="Questions detected" closeLabel="Close">
        <p>Drawer body content</p>
      </BottomDrawer>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open detail' }))
    await screen.findByText('Drawer body content')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => {
      expect(screen.queryByText('Drawer body content')).not.toBeInTheDocument()
    })
  })

  // F9 (dual-review): two drawers can live in the same tree (validation
  // summary + questions detected); a hardcoded title id would collide in the
  // DOM. Opened sequentially: while a dialog is open, Base UI marks the rest
  // of the page inert, so both triggers are never a11y-visible at once.
  it('gives each drawer instance a distinct title id', async () => {
    render(
      <div>
        <BottomDrawer label="Open A" title="Title A" closeLabel="Close">
          <p>Body A</p>
        </BottomDrawer>
        <BottomDrawer label="Open B" title="Title B" closeLabel="Close">
          <p>Body B</p>
        </BottomDrawer>
      </div>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open A' }))
    const idA = (await screen.findByText('Title A')).getAttribute('id')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      expect(screen.queryByText('Title A')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open B' }))
    const idB = (await screen.findByText('Title B')).getAttribute('id')

    expect(idA).toBeTruthy()
    expect(idB).toBeTruthy()
    expect(idA).not.toBe(idB)
  })

  // F7b: pin the dialog semantics — screen readers must announce a modal
  // dialog whose accessible name comes from the drawer title.
  it('exposes role=dialog with aria-modal and the title wired via aria-labelledby', async () => {
    render(
      <BottomDrawer label="Open detail" title="Questions detected" closeLabel="Close">
        <p>Drawer body content</p>
      </BottomDrawer>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open detail' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(screen.getByText('Questions detected')).toHaveAttribute('id', labelledBy)
  })

  // §72 (restore focus al cerrar): closing the sheet must return focus to the
  // trigger so keyboard users resume exactly where they left off. Base UI
  // provides this natively — these tests pin the contract.
  it('restores focus to the trigger after closing with the close control', async () => {
    render(
      <BottomDrawer label="Open detail" title="Questions detected" closeLabel="Close">
        <p>Drawer body content</p>
      </BottomDrawer>
    )

    const trigger = screen.getByRole('button', { name: 'Open detail' })
    fireEvent.click(trigger)
    await screen.findByText('Drawer body content')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => {
      expect(screen.queryByText('Drawer body content')).not.toBeInTheDocument()
    })
    expect(document.activeElement).toBe(trigger)
  })

  it('restores focus to the trigger after closing with Escape', async () => {
    render(
      <BottomDrawer label="Open detail" title="Questions detected" closeLabel="Close">
        <p>Drawer body content</p>
      </BottomDrawer>
    )

    const trigger = screen.getByRole('button', { name: 'Open detail' })
    fireEvent.click(trigger)
    await screen.findByText('Drawer body content')

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByText('Drawer body content')).not.toBeInTheDocument()
    })
    expect(document.activeElement).toBe(trigger)
  })
})
