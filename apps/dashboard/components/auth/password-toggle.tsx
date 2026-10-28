"use client";

/**
 * Show/hide control for a password field. Was the word "Show"/"Hide" in 12px
 * text jammed against the input's edge in both forms; an eye icon with a real
 * hit area reads at a glance and does not shift the input's padding.
 */
export function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="password-toggle-btn"
      aria-label={shown ? "Hide password" : "Show password"}
      aria-pressed={shown}
      title={shown ? "Hide password" : "Show password"}
    >
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
        {shown ? (
          <>
            <path
              d="M2.2 10S4.9 4.8 10 4.8 17.8 10 17.8 10 15.1 15.2 10 15.2 2.2 10 2.2 10Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </>
        ) : (
          <>
            <path
              d="M2.2 10S4.9 4.8 10 4.8c1.3 0 2.5.34 3.5.86M17.8 10s-2.7 5.2-7.8 5.2c-1.3 0-2.5-.34-3.5-.86"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M3 17 17 3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
    </button>
  );
}
