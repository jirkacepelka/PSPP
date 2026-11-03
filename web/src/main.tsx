/*
 * PSPP Studio – a modern browser front-end for GNU PSPP.
 * Copyright (C) 2025 PSPP Studio contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto-mono/400.css';
import './styles/icons.css';
import './i18n';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/output.css';
import './styles/print.css';
import { App } from './App';

// Living style guide of the design system: open the app with ?styleguide
const StyleGuide = lazy(() => import('./styleguide/StyleGuide').then((m) => ({ default: m.StyleGuide })));
const showStyleGuide = new URLSearchParams(window.location.search).has('styleguide');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {showStyleGuide ? (
      <Suspense fallback={null}>
        <StyleGuide />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
