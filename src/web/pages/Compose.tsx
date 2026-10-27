import { useNavigate, useSearchParams } from "react-router-dom";
import { Composer } from "../components/Composer";
import { parseAddresses } from "../components/AddressInput";
import { parseMailto } from "../lib/mailto";
import { useCardScroll } from "../lib/cardKeys";

export default function ComposePage() {
  useCardScroll();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  // A browser that opens email links here sends the link as ?mailto=, and the message starts filled in from it.
  const mailto = sp.get("mailto");
  const initial = mailto ? parseMailto(mailto) : { to: parseAddresses(sp.get("to") ?? ""), subject: sp.get("subject") ?? "" };
  // Opened from an email link in a fresh tab there is nothing to go back to, so it goes to the Imbox.
  const leave = () => (mailto ? nav("/", { replace: true }) : nav(-1));
  return (
    <div className="max-w-5xl mx-auto w-full">
      <header className="mb-4 px-2">
        <h1 className="text-[28px] leading-[34px] font-bold tracking-[-0.02em]">New message</h1>
      </header>
      <div className="rounded-lg ring-1 ring-border overflow-hidden">
        <Composer inline autoFocusBody={!!(initial.to?.length || sp.get("to"))} initial={initial} onDone={leave} onCancel={leave} />
      </div>
    </div>
  );
}
