import { useState, useEffect } from 'react'
import { Wizard } from './wizard/Wizard'
import { Splash } from './Splash'

export function App(): React.JSX.Element {
  const [view, setView] = useState<'loading' | 'wizard' | 'splash'>('loading')

  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (hash === 'wizard') {
      setView('wizard')
    } else if (hash === 'splash') {
      setView('splash')
    }
    // No fallback — main process always provides a hash
  }, [])

  if (view === 'wizard') {
    return (
      <Wizard
        onComplete={() => {
          // Tell main process we're done — it owns the window transition
          window.proqDesktop.wizardComplete()
        }}
      />
    )
  }

  if (view === 'splash') {
    return <Splash />
  }

  // Brief loading state while hash is read
  return (
    <div className="splash-container">
      <div className="spinner" />
    </div>
  )
}
