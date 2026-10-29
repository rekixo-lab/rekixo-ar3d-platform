"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const EXIT_MS = 140;
const ENTER_MS = 230;
const TOAST_EXIT_MS = 180;

type MotionPhase = "idle" | "exit" | "enter";

function reducedMotionPreferred() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

export default function MotionSwap({
  motionKey,
  children,
}: {
  motionKey: string;
  children: ReactNode;
}) {
  const key = String(motionKey);
  const stable = useRef({ key, children });
  const latest = useRef({ key, children });
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [displayKey, setDisplayKey] = useState(key);
  const [outgoing, setOutgoing] = useState<ReactNode | null>(null);
  const [phase, setPhase] = useState<MotionPhase>("idle");

  latest.current = { key, children };

  useEffect(() => {
    if (key === displayKey) {
      if (phase !== "exit") stable.current = { key, children };
      return;
    }

    if (exitTimer.current) clearTimeout(exitTimer.current);

    if (reducedMotionPreferred()) {
      setDisplayKey(key);
      setOutgoing(null);
      setPhase("idle");
      stable.current = latest.current;
      return;
    }

    setOutgoing(stable.current.children);
    setPhase("exit");

    exitTimer.current = setTimeout(() => {
      const next = latest.current;
      setDisplayKey(next.key);
      setOutgoing(null);
      setPhase("enter");
      stable.current = next;
    }, EXIT_MS);

    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, [key, displayKey]);

  useEffect(() => {
    if (phase !== "enter") return;
    if (reducedMotionPreferred()) {
      setPhase("idle");
      return;
    }
    const timer = setTimeout(() => setPhase("idle"), ENTER_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (key === displayKey && phase !== "exit") {
      stable.current = { key, children };
    }
  }, [key, displayKey, children, phase]);

  const switching = key !== displayKey;
  const content =
    phase === "exit" || switching
      ? outgoing ?? stable.current.children
      : children;

  return (
    <div
      className="rekixo-motion-swap"
      data-motion-key={displayKey}
      data-motion-phase={phase}
    >
      {content}
    </div>
  );
}

export function MotionToast({ message, tone="success" }: { message: string; tone?:"success"|"error" }) {
  const [rendered, setRendered] = useState(message);
  const [state, setState] = useState<"open" | "closing">("open");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);

    if (message) {
      setRendered(message);
      setState("open");
      return;
    }

    if (!rendered) return;
    setState("closing");
    timer.current = setTimeout(() => {
      setRendered("");
    }, reducedMotionPreferred() ? 0 : TOAST_EXIT_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [message, rendered]);

  if (!rendered) return null;

  return (
    <div className="toast-admin" data-motion-state={state} data-tone={tone} role={tone==="error"?"alert":"status"}>
      {rendered}
    </div>
  );
}
