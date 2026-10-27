import { ScrollText } from "lucide-react";
import type { TabId } from "../lib/menuPresets";
import { BrandIcon } from "./BrandIcons";

/** The icon for each page in the More menu's tiles. They are the ones the phone's More screen uses. */
export const DESTINATION_ICON: Record<TabId, React.ReactNode> = {
  imbox: <BrandIcon name="imbox" />,
  screener: <BrandIcon name="screener" />,
  updates: <BrandIcon name="feed" />,
  trays: <BrandIcon name="set-aside" />,
  contacts: <BrandIcon name="sender" />,
  calendar: <BrandIcon name="calendar" />,
  drafts: <BrandIcon name="drafts" />,
  sent: <BrandIcon name="sent" />,
  scheduled: <BrandIcon name="scheduled" />,
  everything: <BrandIcon name="imbox" />,
  previously_seen: <BrandIcon name="let-in" />,
  screened_out: <BrandIcon name="not-now" />,
  trash: <BrandIcon name="trash" />,
  files: <BrandIcon name="files" />,
  clips: <BrandIcon name="clips" />,
  collections: <BrandIcon name="collection" />,
  labels: <BrandIcon name="labels" />,
  workflows: <BrandIcon name="workflows" />,
  logs: <ScrollText />,
};
