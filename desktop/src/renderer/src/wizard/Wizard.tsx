import { useState } from 'react'
import { Welcome } from './Welcome'
import { Location } from './Location'
import { Dependencies } from './Dependencies'
import { Preferences } from './Preferences'
import { Installing } from './Installing'

const STEPS = ['welcome', 'location', 'dependencies', 'preferences', 'installing'] as const
type Step = (typeof STEPS)[number]

interface WizardProps {
  startStep?: string
  onComplete: () => void
}

export function Wizard({ startStep, onComplete }: WizardProps): React.JSX.Element {
  const [step, setStep] = useState<Step>(
    STEPS.includes(startStep as Step) ? (startStep as Step) : 'welcome'
  )
  const [proqPath, setProqPath] = useState('')
  const [claudePath, setClaudePath] = useState('')

  const stepIndex = STEPS.indexOf(step)
  const next = (): void => setStep(STEPS[stepIndex + 1])
  const back = (): void => setStep(STEPS[stepIndex - 1])

  return (
    <div className="wizard-container">
      <div className="titlebar-drag" style={{ height: 28, marginTop: -16, marginBottom: -12 }} />

      <div
        className="steps"
        style={{
          opacity: step === 'welcome' ? 0 : 1,
          transition: 'opacity 0.4s ease'
        }}
      >
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
      {step === 'preferences' && (
        <Preferences
          onNext={startStep === 'preferences' ? onComplete : next}
          onBack={startStep === 'preferences' ? onComplete : back}
        />
      )}
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
