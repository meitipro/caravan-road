import type { ReactNode } from "react";
import { PlayRoot } from "../../components/Entry";

export default function PlayLayout({ children }: { children: ReactNode }) {
  return <PlayRoot>{children}</PlayRoot>;
}
