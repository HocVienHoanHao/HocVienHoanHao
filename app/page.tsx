import { redirect } from "next/navigation";
import { getViewer, homeFor } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const v = await getViewer();
  redirect(v ? homeFor(v) : "/login");
}
