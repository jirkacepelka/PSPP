/*
 * PSPP Studio – a modern browser front-end for GNU PSPP.
 * Copyright (C) 2025 PSPP Studio contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto-mono/400.css';
import 'material-symbols/rounded.css';
import './i18n';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/output.css';
import './styles/print.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
