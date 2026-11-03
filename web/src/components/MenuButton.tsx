/*
 * MenuButton — a Button or IconButton that opens a <Menu> below itself.
 * Enter / Space / ↓ open the menu and focus the first item; closing returns focus to the trigger.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useRef, useState, type KeyboardEvent } from 'react';
import { Button, type ButtonVariant } from './Button';
import { IconButton } from './IconButton';
import { Menu, type Anchor, type MenuEntry } from './Menu';

interface MenuButtonProps {
  items: MenuEntry[];
  /** visible text (Button) or accessible name (IconButton when `iconOnly`) */
  label: string;
  icon?: string;
  iconOnly?: boolean;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  menuLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function MenuButton({ items, label, icon, iconOnly, variant = 'secondary', size = 'md', menuLabel, disabled, className = '' }: MenuButtonProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<(Anchor & { focus: boolean }) | null>(null);

  const open = (focus: boolean) => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    setAnchor({ x: r.left, y: r.bottom + 4, altX: r.right, focus });
  };
  const toggle = () => (anchor ? setAnchor(null) : open(true));
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      open(true);
    }
  };
  const common = {
    ref: trigger,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': !!anchor,
    'data-menu-trigger': true,
    disabled,
    onClick: toggle,
    onKeyDown,
    className,
  };

  return (
    <>
      {iconOnly ? (
        <IconButton icon={icon ?? 'more_vert'} label={label} tip={!anchor} small={size === 'sm'} {...common} />
      ) : (
        <Button variant={variant} size={size} iconStart={icon} iconEnd="expand_more" {...common}>
          {label}
        </Button>
      )}
      {anchor && (
        <Menu
          items={items}
          anchor={anchor}
          label={menuLabel ?? label}
          autoFocus={anchor.focus}
          onClose={(reason) => {
            setAnchor(null);
            if (reason !== 'outside') trigger.current?.focus();
          }}
        />
      )}
    </>
  );
}
