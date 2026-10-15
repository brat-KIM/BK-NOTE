import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { boot } from './app/boot';
import { ServicesContext } from './app/services';
import { App } from './components/App';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

void boot().then(({ services, needsLogin }) => {
  root.render(
    <StrictMode>
      <ServicesContext.Provider value={services}>
        <App needsLogin={needsLogin} />
      </ServicesContext.Provider>
    </StrictMode>,
  );
});
