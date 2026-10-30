import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
const Admin = lazy(() => import('./Admin').then((m) => ({ default: m.Admin })));
const Broadcast = lazy(() => import('./Broadcast').then((m) => ({ default: m.Broadcast })));
const GameScreen = lazy(() => import('./GameScreen').then((m) => ({ default: m.GameScreen })));
import '@fontsource/be-vietnam-pro/vietnamese-400.css';
import '@fontsource/be-vietnam-pro/latin-400.css';
import '@fontsource/be-vietnam-pro/vietnamese-500.css';
import '@fontsource/be-vietnam-pro/latin-500.css';
import '@fontsource/be-vietnam-pro/vietnamese-600.css';
import '@fontsource/be-vietnam-pro/latin-600.css';
import '@fontsource/lora/vietnamese-400.css';
import '@fontsource/lora/latin-400.css';
import '@fontsource/lora/vietnamese-400-italic.css';
import '@fontsource/lora/latin-400-italic.css';
import './styles.css';
import './upgrade.css';
import './experience.css';
import './game.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense
      fallback={
        <div className="game-loading" role="status">
          Đang mở cửa chánh điện…
        </div>
      }
    >
      {location.pathname.startsWith('/admin') ? (
        <Admin />
      ) : location.pathname.startsWith('/broadcast/') ? (
        <Broadcast />
      ) : (
        <GameScreen />
      )}
    </Suspense>
  </React.StrictMode>,
);
