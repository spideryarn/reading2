/**
 * **Brightness and Text size** — the rows under Appearance in `/profile`'s
 * Settings card. Greg, 2026-10-18 (spya-q645m0, spya-ast8cu): *"the setting
 * for it should live in the user profile rather than in the article metadata."*
 *
 * Native radios in a `<fieldset>`, applied the moment one is picked, for the
 * reasons AppearanceSetting.tsx gives; kept on this device for the reasons
 * reading-comfort.ts gives.
 */
import {
  BRIGHTNESS,
  type Brightness,
  type ComfortSetting,
  setComfort,
  TEXT_SIZE,
  type TextSize,
  useComfort,
  useComfortSaved,
} from "./reading-comfort.js";

const BRIGHTNESS_LABEL: Record<Brightness, string> = {
  full: "Full",
  dim: "Dim",
  dimmer: "Dimmer",
  dimmest: "Dimmest",
};
const TEXT_SIZE_LABEL: Record<TextSize, string> = {
  default: "Default",
  large: "Large",
  larger: "Larger",
  largest: "Largest",
};

function Row<V extends string>({
  legend,
  name,
  setting,
  labels,
}: {
  legend: string;
  name: string;
  setting: ComfortSetting<V>;
  labels: Record<V, string>;
}) {
  const choice = useComfort(setting);
  return (
    <fieldset className="tw:m-0 tw:flex tw:flex-col tw:gap-1.5 tw:border-0 tw:p-0">
      <legend className="tw:mb-1.5 tw:p-0 tw:text-sm tw:text-foreground">{legend}</legend>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-4 tw:gap-y-1.5">
        {setting.values.map((value) => (
          <label key={value} className="tw:flex tw:items-center tw:gap-1.5 tw:text-sm tw:text-foreground">
            <input
              type="radio"
              name={name}
              value={value}
              className="tw:[accent-color:var(--highlight-text)]"
              checked={choice === value}
              onChange={() => setComfort(setting, value)}
            />
            <span>{labels[value]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ReadingComfortSettings() {
  const saved = useComfortSaved();
  return (
    <div className="tw:flex tw:flex-col tw:gap-4">
      <Row legend="Brightness" name="brightness" setting={BRIGHTNESS} labels={BRIGHTNESS_LABEL} />
      <Row legend="Text size" name="text-size" setting={TEXT_SIZE} labels={TEXT_SIZE_LABEL} />
      <p className="tw:m-0 tw:text-xs tw:text-ink-faint">
        Brightness dims the whole page, below your screen's own lowest setting. Text size scales
        everything, as zooming in would.{" "}
        {!saved
          ? "Couldn't save it on this device, so it lasts until you close this page."
          : "Saved on this device."}
      </p>
    </div>
  );
}
