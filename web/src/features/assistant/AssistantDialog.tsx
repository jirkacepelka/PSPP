/*
 * Analysis assistant: goal-based guide that recommends the right analysis and opens its dialog
 * pre-filled.  (Placeholder; implemented by the analysis & output work package.)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useUi } from '../../store/ui';

export function AssistantDialog() {
  const close = useUi((s) => s.closeModal);
  return (
    <div role="dialog" aria-modal="true" className="dialog-scrim" onClick={close}>
      <div className="dialog">Analysis assistant</div>
    </div>
  );
}
