/* SPDX-License-Identifier: GPL-3.0-or-later */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import cs from './cs.json';
import en from './en.json';
import { detectLanguage } from '../store/settings';

void i18n.use(initReactI18next).init({
  resources: { cs: { translation: cs }, en: { translation: en } },
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
