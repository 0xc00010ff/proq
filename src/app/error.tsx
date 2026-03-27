'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-zinc-100 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200">
      <div className="flex flex-col items-center gap-4 text-center">
        <h2 className="text-lg font-medium">Something went wrong</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md">
          {error.message || 'An unexpected error occurred.'}
        </p>
        <button
          onClick={reset}
          className="rounded-md bg-bronze-700 px-4 py-2 text-sm font-medium text-white hover:bg-bronze-600 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
