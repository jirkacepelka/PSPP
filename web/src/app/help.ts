/* SPDX-License-Identifier: GPL-3.0-or-later */
export const MANUAL_BASE = 'https://www.gnu.org/software/pspp/manual/html_node/';
export const SOURCE_URL = 'https://github.com/jirkacepelka/PSPP';
export const PSPP_URL = 'https://www.gnu.org/software/pspp/';
export const GPL_URL = 'https://www.gnu.org/licenses/gpl-3.0.html';

/** URL of the PSPP manual page for a command (texinfo HTML node naming). */
export function manualUrl(command?: string): string {
  if (!command) return `${MANUAL_BASE}index.html`;
  const node = command
    .toUpperCase()
    .replace(/-/g, '_002d')
    .replace(/ /g, '-');
  return `${MANUAL_BASE}${node}.html`;
}
