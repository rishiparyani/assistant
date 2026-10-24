// /chat as an address (a deep link, Siri, the test launch): the chat is a sheet over the screen
// (docs/design/from-scratch.md §3), so this opens it over Today and goes there.
import { useEffect, useRef } from "react";
import { Redirect, useLocalSearchParams } from "expo-router";
import { openChat, type ChatParams } from "@/chat-open";

export default function ChatRoute() {
  const params = useLocalSearchParams<Record<keyof ChatParams, string>>();
  // Once: the address's parameters are what to open with.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    openChat(params);
  }, [params]);
  return <Redirect href="/" />;
}
