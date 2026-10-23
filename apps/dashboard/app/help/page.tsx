import { redirect } from "next/navigation";

// The help centre became the documentation hub.
export default function HelpPage() {
  redirect("/docs");
}
