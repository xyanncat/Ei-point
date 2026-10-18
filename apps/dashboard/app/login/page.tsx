import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginScreen } from "../../components/login-screen";

export const metadata: Metadata = {
  title: "Sign in — Ei point",
  description:
    "Sign in with Discord to order services, verify purchases and open your workspace.",
};

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginScreen />
    </Suspense>
  );
}
