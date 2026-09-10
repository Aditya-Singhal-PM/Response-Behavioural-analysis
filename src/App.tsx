import { AppProvider, useApp } from './state/AppContext';
import { Stepper } from './components/Stepper';
import { SetupScreen } from './screens/SetupScreen';
import { UploadScreen } from './screens/UploadScreen';
import { MappingScreen } from './screens/MappingScreen';
import { SegmentScreen } from './screens/SegmentScreen';
import { RubricScreen } from './screens/RubricScreen';
import { RunScreen } from './screens/RunScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { STEPS } from './types';

function CurrentScreen() {
  const { step } = useApp();
  switch (step) {
    case 'setup':
      return <SetupScreen />;
    case 'upload':
      return <UploadScreen />;
    case 'mapping':
      return <MappingScreen />;
    case 'segment':
      return <SegmentScreen />;
    case 'rubric':
      return <RubricScreen />;
    case 'run':
      return <RunScreen />;
    case 'results':
      return <ResultsScreen />;
    default:
      return <SetupScreen />;
  }
}

function Shell() {
  const { step, fileName, stats } = useApp();
  const meta = STEPS.find((s) => s.id === step);

  return (
    <div className="app">
      <header className="masthead">
        <h1>Response behavioural analysis</h1>
        <p className="sub">
          Judge agent traces against expected behaviour, then find the few patterns
          behind the many failures.
        </p>
        {fileName && (
          <p className="masthead-file">
            {fileName}
            {stats.total > 0 && ` · ${stats.total.toLocaleString()} traces`}
          </p>
        )}
      </header>

      <Stepper />

      <main>
        <p className="step-blurb">{meta?.blurb}</p>
        <CurrentScreen />
      </main>

      <footer className="footer">
        Runs entirely in this browser. Nothing is stored on a server, and a refresh
        clears the run — save a snapshot from the results screen to keep it.
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
