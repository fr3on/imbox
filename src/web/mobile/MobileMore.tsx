import { Screen } from "./Screen";
import { MoreDialogs, MoreMenu, useMoreDialogs } from "./MoreMenu";

/** The More screen, for the pages that go back to it. The More tab opens the same menu as a sheet over the page you are on. */
export default function MobileMore() {
  const d = useMoreDialogs();
  return (
    <Screen title="More" largeTitle>
      <MoreMenu d={d} />
      <MoreDialogs d={d} />
    </Screen>
  );
}
