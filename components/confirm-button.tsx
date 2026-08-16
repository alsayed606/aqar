"use client";

import { useFormStatus } from "react-dom";

// A submit button that asks for confirmation before letting the form submit. Lives inside a
// server-rendered <form action={serverAction}> — on cancel it prevents the submit.
//
// It reads its own pending state rather than taking it as a prop: useFormStatus reports the status
// of the form this button sits in, so every one of its callers gets the guard without passing
// anything. That matters because these are the destructive buttons — terminating a contract,
// reverting an import, deleting a property — and a second click while the first is in flight sends
// the action twice. The database refuses the second, but the office reads the refusal as a failure
// of the first.
export function ConfirmButton({
  message,
  children,
  className,
}: {
  message: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
      className={className ? className + " disabled:opacity-60" : undefined}
    >
      {children}
    </button>
  );
}
