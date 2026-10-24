// /chat as an address (a deep link, Siri, the test launch): the chat is a sheet over the screen
// (docs/design/from-scratch.md §3), so this opens it over Today and goes there. Signed out, the
// gate takes the address to sign-in and back here, and only then does the sheet open.
import { useEffect, useRef } from "react";
import { Redirect, useLocalSearchParams } from "expo-router";
import { openChat, type ChatParams } from "@/chat-open";
import { useSession } from "@/session";

export default function ChatRoute() {
  const params = useLocalSearchParams<Record<keyof ChatParams, string>>();
  const { me } = useSession();
  // Once: the address's parameters are what to open with.
  const opened = useRef(false);
  useEffect(() => {
    if (!me || opened.current) return;
    opened.current = true;
    openChat(params);
  }, [me, params]);
  return me ? <Redirect href="/" /> : null;
}
