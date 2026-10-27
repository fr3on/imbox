import { BrandIcon } from "../components/BrandIcons";
import { useImbox } from "../api";
import { useAccount } from "../context/AccountContext";
import { ConnectGmailCard } from "./Imbox";
import { ThreadList } from "../components/ThreadList";
import { TrayCards } from "../components/TrayCards";
import { KeyLegend } from "../components/KeyLegend";

export default function SetAside() {
  const { accounts } = useAccount();
  const imbox = useImbox(accounts.length > 0);
  if (accounts.length === 0) return <ConnectGmailCard />;
  const list = imbox.data?.set_aside ?? [];
  return (
    <div className="max-w-5xl mx-auto w-full">
      <TrayCards active="set-aside" subtitle={list.length ? `${list.length} set aside. Things you want close at hand.` : "Things you want close at hand. Confirmations, links, reference numbers."} />
      {list.length > 0 && <KeyLegend />}
      <ThreadList
        showBucket
        loading={imbox.isLoading}
        error={imbox.error}
        onRetry={() => imbox.refetch()}
        emptyIcon={<BrandIcon name="set-aside" />}
        sections={[{ threads: list, emptyTitle: "Nothing set aside.", emptyBody: "Press a on any thread to keep it handy here." }]}
      />
    </div>
  );
}
