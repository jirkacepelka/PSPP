/*
 * Chart canvas: the live preview framed by drop zones placed where the role belongs (y along the
 * left edge, x below, legend/size/panel on top, z on the right), like the SPSS Chart Builder.
 * A zone takes a variable by drag and drop, by selecting a variable and clicking the zone, or from
 * its own menu (keyboard, touch). The chip of a summary shows the summary function and has a menu.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import {
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../components/Icon";
import { Menu, type Anchor, type MenuEntry } from "../components/Menu";
import { MeasureIcon } from "../components/Chip";
import { displayMeasure } from "../features/dialogs/dialogData";
import {
  CATEGORY_CROWDED,
  MERGE_KINDS,
  funcChoices,
  needsVariable,
  normalizeOptions,
  rejection,
  slotsOf,
  summaryValueSlot,
  type SlotDef,
  type SlotPlace,
} from "./model";
import type { Picking } from "./Slots";

const DRAG_TYPE = "application/x-pspp-variable";

/** Slots whose zone shows the summary function (when the kind has one). */
const SUMMARY_SLOTS = ["value", "high", "left"];

/** Titles that name an axis in the slot list but not on a canvas (a horizontal bar swaps the axes). */
const ZONE_TITLE: Record<string, string> = {
  "graphstudio.slot.category": "graphstudio.zone.category",
  "graphstudio.slot.yCategory": "graphstudio.zone.category",
};

/** The canvas slots of the chart in the order they are shown, grouped by place. */
export function canvasSlots(p: Picking): Map<SlotPlace, SlotDef[]> {
  const list = slotsOf(p.def);
  const virtual = summaryValueSlot(p.def);
  if (virtual) list.push(virtual);
  const by = new Map<SlotPlace, SlotDef[]>();
  for (const s of list)
    by.set(s.place ?? "detail", [...(by.get(s.place ?? "detail") ?? []), s]);
  return by;
}

/** A menu opened from a button: tracks the anchor and returns the props to spread on the button. */
function useMenuButton(items: () => MenuEntry[], label: string) {
  const ref = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<(Anchor & { focus: boolean }) | null>(
    null,
  );
  const open = (focus: boolean) => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setAnchor({ x: r.left, y: r.bottom + 4, altX: r.right, focus });
  };
  const props = {
    ref,
    "aria-haspopup": "menu" as const,
    "aria-expanded": !!anchor,
    "data-menu-trigger": true,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        open(true);
      }
    },
  };
  const menu = anchor ? (
    <Menu
      items={items()}
      anchor={anchor}
      label={label}
      autoFocus={anchor.focus}
      onClose={(reason) => {
        setAnchor(null);
        if (reason !== "outside") ref.current?.focus();
      }}
    />
  ) : null;
  return {
    props,
    menu,
    open,
    toggle: () => (anchor ? setAnchor(null) : open(true)),
    opened: !!anchor,
  };
}

function Zone({ slot, p }: { slot: SlotDef; p: Picking }) {
  const { t } = useTranslation();
  const {
    ds,
    def,
    distinct,
    selected,
    dragging,
    setDragging,
    assign,
    remove,
    onChange,
  } = p;
  const [over, setOver] = useState(false);
  const bound = def.bind[slot.id] ?? [];
  const active = dragging ?? selected;
  const activeVar = active
    ? ds.variables.findIndex((v) => v.name === active)
    : -1;
  const reason =
    activeVar >= 0
      ? rejection(slot, ds.variables[activeVar], distinct[activeVar])
      : null;
  const ready = activeVar >= 0 && !reason;
  const need = bound.length < slot.min;
  const full = slot.max === 1 ? false : bound.length >= slot.max;
  const title = t(ZONE_TITLE[slot.label] ?? slot.label);
  const hint = t(slot.hint ?? "graphstudio.slotHint.default");
  const titleId = `gs-zone-${slot.id}`;

  const variableItems = (): MenuEntry[] =>
    ds.variables
      .map((v, i) => ({ v, rej: rejection(slot, v, distinct[i]) }))
      .filter((o) => !bound.includes(o.v.name))
      .map(({ v, rej }) => ({
        type: "item" as const,
        id: v.name,
        label: rej
          ? `${v.name} (${t(rej.key, rej.args)})`
          : v.label
            ? `${v.name} (${v.label})`
            : v.name,
        disabled: !!rej || full,
        onSelect: () => assign(slot, v.name),
      }));
  const opener = useMenuButton(variableItems, title);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const name =
      e.dataTransfer.getData(DRAG_TYPE) || e.dataTransfer.getData("text/plain");
    setDragging(null);
    const i = ds.variables.findIndex((v) => v.name === name);
    if (i >= 0 && !rejection(slot, ds.variables[i], distinct[i]))
      assign(slot, name);
  };

  // a category variable with a huge number of values: still drawn in full, but say it is crowded
  const crowdedIdx =
    slot.id === "x" &&
    MERGE_KINDS.includes(def.kind) &&
    (def.options.mergeMode ?? "none") === "none"
      ? ds.variables.findIndex((x) => x.name === bound[0])
      : -1;
  const crowded = crowdedIdx >= 0 && distinct[crowdedIdx] > CATEGORY_CROWDED;

  const choices = funcChoices(def);
  const showFunc = SUMMARY_SLOTS.includes(slot.id) && choices.length > 0;
  const funcValue = String(def.options.func ?? "");
  const funcLabel = choices.find((c) => c.value === funcValue)?.label;
  const funcMenu = useMenuButton(
    () =>
      choices.map((c) => ({
        type: "item" as const,
        id: c.value,
        label: t(c.label),
        checked: c.value === funcValue,
        onSelect: () => {
          const options = { ...def.options, func: c.value };
          const bind = needsVariable(c.value)
            ? def.bind
            : { ...def.bind, value: [] };
          onChange(normalizeOptions({ ...def, options, bind }));
        },
      })),
    t("graphstudio.zone.summary"),
  );

  const empty = bound.length === 0;
  const cls = [
    "gs-zone",
    `gs-place-${slot.place}`,
    empty ? "empty" : "filled",
    ready ? "ready" : "",
    over && ready ? "over" : "",
    reason ? "blocked" : "",
    need ? "need" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const onMain = () =>
    ready && selected ? assign(slot, selected) : opener.toggle();

  return (
    <div
      className={cls}
      data-slot={slot.id}
      onDragOver={(e) => {
        if (dragging && !reason) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOver(false);
      }}
      onDrop={onDrop}
    >
      <span className="gs-zone-title" id={titleId}>
        <Icon name={slot.icon} />
        <span className="gs-zone-label">{title}</span>
        {slot.min > 0 && (
          <span className="gs-zone-req" title={t("graphstudio.required")}>
            <span aria-hidden="true">*</span>
            <span className="sr-only">{t("graphstudio.required")}</span>
          </span>
        )}
      </span>
      {empty ? (
        <button
          type="button"
          className="gs-zone-main"
          aria-labelledby={titleId}
          aria-describedby={`${titleId}-hint`}
          title={hint}
          {...opener.props}
          onClick={onMain}
        >
          <span className="gs-zone-hint" id={`${titleId}-hint`}>
            {ready ? t("graphstudio.clickToAdd", { name: active }) : hint}
          </span>
        </button>
      ) : null}
      <div className="gs-zone-chips">
        {showFunc && empty && (
          <button
            type="button"
            className="chip gs-func"
            aria-label={t("graphstudio.zone.summaryOf", { slot: title })}
            title={t("graphstudio.zone.summary")}
            {...funcMenu.props}
            onClick={funcMenu.toggle}
          >
            <span className="chip-text">
              {funcLabel ? t(funcLabel) : t("graphstudio.zone.summary")}
            </span>
            <Icon name="arrow_drop_down" />
          </button>
        )}
        {bound.map((name) => {
          const i = ds.variables.findIndex((x) => x.name === name);
          const merged = showFunc && bound.length === 1;
          return (
            <span
              key={name}
              className="chip gs-chip"
              title={ds.variables[i]?.label || name}
            >
              {i >= 0 && (
                <MeasureIcon
                  measure={displayMeasure(ds.variables[i])}
                  size={16}
                />
              )}
              {merged ? (
                <button
                  type="button"
                  className="gs-func-inline"
                  aria-label={t("graphstudio.zone.summaryOf", { slot: title })}
                  {...funcMenu.props}
                  onClick={funcMenu.toggle}
                >
                  {funcLabel
                    ? t("graphstudio.zone.funcOf", { func: t(funcLabel), name })
                    : name}
                  <Icon name="arrow_drop_down" />
                </button>
              ) : (
                <span className="chip-text">{name}</span>
              )}
              <button
                type="button"
                className="chip-remove"
                aria-label={t("graphstudio.removeVariable", { name })}
                onClick={() => remove(slot, name)}
              >
                <Icon name="close" />
              </button>
            </span>
          );
        })}
        {!empty && !full && (
          <button
            type="button"
            className="gs-zone-add"
            aria-labelledby={titleId}
            title={
              slot.max === 1
                ? t("graphstudio.zone.replace")
                : t("graphstudio.addVariable")
            }
            {...opener.props}
            onClick={onMain}
          >
            <Icon name={slot.max === 1 ? "swap_horiz" : "add"} />
          </button>
        )}
      </div>
      {crowded && (
        <p
          className="gs-zone-why gs-zone-warn"
          role="status"
          title={t("graphstudio.slotCrowded", {
            name: bound[0],
            max: CATEGORY_CROWDED,
          })}
        >
          <Icon name="priority_high" />
          {t("graphstudio.zone.crowded")}
        </p>
      )}
      {reason && (
        <p
          className="gs-zone-why"
          role="status"
          title={t(reason.key, reason.args)}
        >
          <Icon name="block" />
          {t(reason.key, reason.args)}
        </p>
      )}
      {opener.menu}
      {funcMenu.menu}
    </div>
  );
}

/** Frames CHILDREN (the preview) with the zones of the chart. */
export function Canvas({
  p,
  enabled,
  children,
}: {
  p: Picking;
  enabled: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (!enabled) return <>{children}</>;
  const by = canvasSlots(p);
  const zones = (...places: SlotPlace[]) =>
    places
      .flatMap((pl) => by.get(pl) ?? [])
      .map((s) => <Zone key={s.id} slot={s} p={p} />);
  const top = zones("panelCols", "legend", "size", "detail");
  const left = zones("y");
  const right = zones("y2", "z", "panelRows");
  const bottom = zones("x");
  return (
    <div
      className="gs-canvas"
      role="group"
      aria-label={t("graphstudio.zone.canvas")}
    >
      {top.length > 0 && <div className="gs-canvas-top">{top}</div>}
      {left.length > 0 && <div className="gs-canvas-left">{left}</div>}
      <div className="gs-canvas-mid">{children}</div>
      {right.length > 0 && <div className="gs-canvas-right">{right}</div>}
      {bottom.length > 0 && <div className="gs-canvas-bottom">{bottom}</div>}
    </div>
  );
}
