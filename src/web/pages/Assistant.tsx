import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { assistant } from "../lib/assistantStore";

/** Desktop: /assistant(/:id) is only a link target. It expands the docked assistant and returns to the previous page. */
export default function Assistant() {
  const { id } = useParams();
  const nav = useNavigate();
  useEffect(() => {
    assistant.open(id && id !== "new" ? id : null);
    if (window.history.length > 1) nav(-1);
    else nav("/", { replace: true });
  }, [id]);
  return null;
}
