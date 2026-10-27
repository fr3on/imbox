import { Onboarding } from "../components/Onboarding";

/** First-run setup. Its own route, so it stays on screen while the account list changes underneath it. */
export default function Welcome() {
  return <Onboarding />;
}
