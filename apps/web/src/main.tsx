import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { boot } from './app/boot';
import { ServicesContext } from './app/services';
import { App } from './components/App';
import { QuickCapture } from './components/QuickCapture';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

const quick = new URLSearchParams(location.search).get('quick') === '1';
if (quick) document.documentElement.classList.add('quick');

void boot(undefined, quick ? 'quick' : 'main').then(({ services, needsLogin }) => {
  root.render(
    <StrictMode>
      <ServicesContext.Provider value={services}>
        {quick ? <QuickCapture /> : <App needsLogin={needsLogin} />}
      </ServicesContext.Provider>
    </StrictMode>,
  );
});
