import "./globals.css";
import type { Metadata } from "next";
import Taskbar from "@/components/Taskbar";
export const metadata: Metadata = {
  title: "SPHEREx Blink – spot moving objects in the infrared sky",
  description: "Blink SPHEREx sky images over time to find comets, asteroids, brown dwarfs and more.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}<Taskbar /></body></html>);
}
