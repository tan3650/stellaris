"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
export default function Taskbar() {
  const path = usePathname();
  const [t, setT] = useState("");
  useEffect(() => { const f = () => setT(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })); f(); const i = setInterval(f, 15000); return () => clearInterval(i); }, []);
  return (
    <footer className="taskbar">
      <Link className="start" href="/"><i>■</i> Start</Link>
      <Link className={"tbtn" + (path === "/" ? " on" : "")} href="/">◎ Blink the sky</Link>
      <Link className={"tbtn" + (path === "/data" ? " on" : "")} href="/data">▤ Real data &amp; docs</Link>
      <span className="tray">{t}</span>
    </footer>
  );
}
