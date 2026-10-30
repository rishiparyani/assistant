// Needs you is now the top of the Inbox (docs/design/chats-base.md, "The bell: one inbox"); this
// address stays so older links still land there.
import { Redirect } from "expo-router";

export default function Needs() {
  return <Redirect href="/updates" />;
}
