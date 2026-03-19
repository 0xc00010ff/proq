import { useState, useEffect } from 'react'

interface WelcomeProps {
  onNext: () => void
}

type Phase = 'blank' | 'logo' | 'reveal'

function AnimatedLogo(): React.JSX.Element {
  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 256 256"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ marginBottom: 28 }}
    >
      <path
        d="M36.3813 253V16H219.618V173.41H89.6223V69.6509H165.507V121.235H128.533"
        stroke="#E4BD89"
        strokeWidth="27"
        strokeDasharray="976"
        strokeDashoffset="976"
      >
        <animate
          attributeName="stroke-dashoffset"
          values="976;0"
          keyTimes="0;1"
          dur="1.25s"
          repeatCount="1"
          fill="freeze"
          calcMode="spline"
          keySplines="0 0 0.58 1"
        />
      </path>
    </svg>
  )
}

export function Welcome({ onNext }: WelcomeProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('blank')

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('logo'), 2000)
    const t2 = setTimeout(() => setPhase('reveal'), 3500)
    return (): void => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

  return (
    <>
      <div
        className="wizard-content"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          paddingBottom: 60
        }}
      >
        <div
          style={{
            transform: phase === 'reveal' ? 'translateY(0)' : 'translateY(100px)',
            opacity: phase === 'blank' ? 0 : 1,
            transition: 'transform 0.8s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease'
          }}
        >
          {phase !== 'blank' && <AnimatedLogo />}
        </div>

        <div
          style={{
            opacity: phase === 'reveal' ? 1 : 0,
            transform: phase === 'reveal' ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 0.6s ease 0.1s, transform 0.6s ease 0.1s',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
          }}
        >
          <h1
            style={{
              fontSize: 32,
              fontWeight: 800,
              marginBottom: 16,
              fontFamily: 'var(--font-display)',
              textTransform: 'lowercase'
            }}
          >
            proq
          </h1>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: 15,
              textAlign: 'center',
              maxWidth: 380,
              lineHeight: 1.6
            }}
          >
            <strong>An agentic coding IDE.</strong>
            <br />
            proq simplifies multi-agent orchestration so you can build fast and high quality
            software.
          </p>
        </div>

        <button
          className="btn-accent"
          onClick={onNext}
          style={{
            minWidth: 160,
            marginTop: 28,
            opacity: phase === 'reveal' ? 1 : 0,
            transform: phase === 'reveal' ? 'translateY(0)' : 'translateY(8px)',
            transition: 'opacity 0.6s ease 0.3s, transform 0.6s ease 0.3s'
          }}
        >
          Get Started
        </button>
      </div>
    </>
  )
}
