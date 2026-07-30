import { Suspense } from "react";
import RegisterForm from "@/components/RegisterForm";

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-center text-2xl font-bold text-slate-900">
          הרשמת צוות
        </h1>
        <p className="mb-6 text-center text-sm text-slate-500">
          נוכחות מעלה גמלא
        </p>
        <Suspense>
          <RegisterForm />
        </Suspense>
      </div>
    </main>
  );
}
