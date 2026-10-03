/**
 * **Appearance: System, Light or Dark** — the first row of `/profile`'s
 * Settings card. Greg, 2026-09-05 (spya-nv5bzx):
 *
 * > Allow me to switch between Light, Dark, and System modes (in my Profile page).
 *
 * Applied the moment it is picked, with no Save button, because there is no
 * server to wait for: the choice is kept on this device (appearance.ts says
 * why it is not on the profile row). Native radios in a `<fieldset>`, for the
 * reason SettingsSection.tsx gives for its checkbox — the browser keeps the
 * focus ring, the arrow keys and the grouping, and this page invents no second
 * kind of control.
 */
import { Monitor, Moon, Sun } from "lucide-react";

import {
  type Appearance,
  APPEARANCES,
  setAppearance,
  useAppearance,
  useAppearanceSaved,
} from "./appearance.js";

const LABEL: Record<Appearance, string> = { system: "System", light: "Light", dark: "Dark" };
const ICON: Record<Appearance, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };

export function AppearanceSetting() {
  const choice = useAppearance();
  const saved = useAppearanceSaved();
  return (
    <fieldset className="tw:m-0 tw:flex tw:flex-col tw:gap-1.5 tw:border-0 tw:p-0">
      <legend className="tw:mb-1.5 tw:p-0 tw:text-sm tw:text-foreground">Appearance</legend>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-4 tw:gap-y-1.5">
        {APPEARANCES.map((value) => {
          const Icon = ICON[value];
          return (
            <label
              key={value}
              className="tw:flex tw:items-center tw:gap-1.5 tw:text-sm tw:text-foreground"
            >
              <input
                type="radio"
                name="appearance"
                value={value}
                className="tw:[accent-color:var(--highlight-text)]"
                checked={choice === value}
                onChange={() => setAppearance(value)}
              />
              <Icon size={13} className="tw:text-ink-faint" />
              <span>{LABEL[value]}</span>
            </label>
          );
        })}
      </div>
      <p className="tw:m-0 tw:text-xs tw:text-ink-faint">
        {choice === "system" ? "Follows your device's light or dark setting. " : ""}
        {!saved
          ? "Couldn't save it on this device, so it lasts until you close this page."
          : "Saved on this device."}
      </p>
    </fieldset>
  );
}
