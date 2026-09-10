import { STEPS } from '../types';
import { useApp } from '../state/AppContext';

export function Stepper() {
  const { step, goTo, reachable } = useApp();
  const currentIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <nav className="stepper" aria-label="Pipeline steps">
      {STEPS.map((s, i) => {
        const ok = reachable(s.id);
        const state = s.id === step ? 'current' : i < currentIndex ? 'done' : 'todo';
        return (
          <button
            key={s.id}
            type="button"
            className={`step step-${state}`}
            disabled={!ok}
            aria-current={s.id === step ? 'step' : undefined}
            onClick={() => ok && goTo(s.id)}
            title={ok ? s.blurb : 'Earlier steps are not finished'}
          >
            <span className="step-num">{i + 1}</span>
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}
