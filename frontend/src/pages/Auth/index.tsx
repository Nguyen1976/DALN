import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/layouts/AuthShell";

export default function AuthPage() {
  return (
    <AuthShell>
      <AuthForm />
    </AuthShell>
  );
}
