import { useState } from 'react'
import { Welcome } from './Welcome'
import { Location } from './Location'
import { Dependencies } from './Dependencies'
import { Preferences } from './Preferences'
import { Installing } from './Installing'

const STEPS = ['welcome', 'location', 'dependencies', 'preferences', 'installing'] as const
type Step = (typeof STEPS)[number]

interface WizardProps {
  onComplete: () => void
}

export function Wizard({ onComplete }: WizardProps): React.JSX.Element {
  const [step, setStep] = useState<Step>('welcome')
  const [proqPath, setProqPath] = useState('')
  const [claudePath, setClaudePath] = useState('')

  const stepIndex = STEPS.indexOf(step)
  const next = (): void => setStep(STEPS[stepIndex + 1])
  const back = (): void => setStep(STEPS[stepIndex - 1])

  return (
    <div className="wizard-container">
      <div className="titlebar-drag" style={{ height: 28, marginTop: -16, marginBottom: -12 }} />

      <div className="steps">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`step-dot ${i === stepIndex ? 'active' : i < stepIndex ? 'completed' : ''}`}
          />
        ))}
      </div>

      {step === 'welcome' && <Welcome onNext={next} />}
      {step === 'location' && (
        <Location proqPath={proqPath} setProqPath={setProqPath} onNext={next} onBack={back} />
      )}
      {step === 'dependencies' && (
        <Dependencies
          claudePath={claudePath}
          setClaudePath={setClaudePath}
          onNext={next}
          onBack={back}
        />
      )}
      {step === 'preferences' && <Preferences onNext={next} onBack={back} />}
      {step === 'installing' && (
        <Installing
          proqPath={proqPath}
          claudePath={claudePath}
          onComplete={onComplete}
          onBack={back}
        />
      )}
    </div>
  )
}
