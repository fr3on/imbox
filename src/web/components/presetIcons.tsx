import type { PresetId } from "../lib/menuPresets";
import { BrandIcon } from "./BrandIcons";

/** The icon that stands for each menu style, on the desktop menu and the phone's More screen alike. */
export const PRESET_ICON: Record<PresetId, React.ReactNode> = {
  complete: <BrandIcon name="menu-style" />,
  triage: <BrandIcon name="screener" />,
  support: <BrandIcon name="sender" />,
  scheduler: <BrandIcon name="scheduled" />,
  minimal: <BrandIcon name="imbox" />,
};
