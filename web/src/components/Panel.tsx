/*
 * Panel / Section — a titled region with optional actions; collapsible with a disclosure button.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createElement, useId, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface PanelProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** buttons rendered at the right of the header (IconButtons, a small Button) */
  actions?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** controlled open state */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** default = bordered surface · flush = no frame (sections inside dialogs) · sunken = well */
  variant?: 'default' | 'flush' | 'sunken';
  /** hairline between header and body */
  divided?: boolean;
  headingLevel?: 2 | 3 | 4;
  className?: string;
  children: ReactNode;
}

export function Panel({ title, subtitle, actions, collapsible, defaultOpen = true, open: openProp, onOpenChange, variant = 'default', divided, headingLevel = 3, className = '', children }: PanelProps) {
  const id = useId();
  const [inner, setInner] = useState(defaultOpen);
  const open = openProp ?? inner;
  const toggle = () => {
    const next = !open;
    if (openProp === undefined) setInner(next);
    onOpenChange?.(next);
  };
  const titleBody = (
    <>
      <span>{title}</span>
      {subtitle && <span className="panel-subtitle">{subtitle}</span>}
    </>
  );
  const heading = createElement(
    `h${headingLevel}`,
    { className: 'panel-title', id: `${id}-title` },
    collapsible ? (
      <button type="button" className="panel-toggle" aria-expanded={open} aria-controls={`${id}-body`} onClick={toggle}>
        <Icon name="expand_more" size={18} />
        <span className="panel-title-text">{titleBody}</span>
      </button>
    ) : (
      titleBody
    ),
  );
  return (
    <section className={`panel ${variant !== 'default' ? variant : ''} ${divided ? 'divided' : ''} ${className}`} aria-labelledby={`${id}-title`}>
      <div className="panel-header">
        {heading}
        {actions && <div className="panel-actions">{actions}</div>}
      </div>
      <div className="panel-body" id={`${id}-body`} hidden={collapsible ? !open : undefined}>
        {children}
      </div>
    </section>
  );
}
