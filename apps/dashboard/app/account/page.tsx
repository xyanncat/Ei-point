import { redirect } from "next/navigation";

// The servers tab is the default view of the account area.
export default function AccountPage() {
  redirect("/account/servers");
}
