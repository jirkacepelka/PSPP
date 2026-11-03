/*
 * PSPP Studio mark: a calm graphite tile with a single distribution curve drawn in the
 * user's accent colour over a quiet baseline — "a quiet desk for careful numbers".
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export function LogoMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`logo-mark ${className}`} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect className="logo-tile" x="0" y="0" width="32" height="32" rx="7" />
      <path className="logo-base" d="M6.5 24.5h19" />
      <path className="logo-mean" d="M16 10.5v14" />
      <path className="logo-curve" d="M5 23.5C9.6 23.5 11 10.5 16 10.5S22.4 23.5 27 23.5" />
      <circle className="logo-dot" cx="22.5" cy="9" r="1.9" />
    </svg>
  );
}
