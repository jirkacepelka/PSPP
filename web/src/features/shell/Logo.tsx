/*
 * PSPP Studio mark: a "P" whose bowl is a pie chart with one slice pulled out – the letter
 * and the statistics in one shape. Drawn in the user's accent colour.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export function LogoMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`logo-mark ${className}`} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect className="logo-tile" x="0" y="0" width="32" height="32" rx="8" />
      <rect className="logo-glyph" x="9.3" y="7.2" width="4.4" height="17.6" rx="2.2" />
      <path className="logo-glyph" d="M15.3 13.2H21.3A6 6 0 1 1 15.3 7.2Z" />
      <path className="logo-slice" d="M16.6 11.9V5.9A6 6 0 0 1 22.6 11.9Z" />
    </svg>
  );
}
