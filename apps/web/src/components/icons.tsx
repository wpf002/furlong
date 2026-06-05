import type { SVGProps } from 'react';

// Shared inline SVG icons (replacing emoji). All inherit currentColor.

export function HorseIcon({ className = 'h-5 w-5', ...props }: SVGProps<SVGSVGElement>) {
  // Chess-knight horse head — clean, recognizable at small sizes.
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden {...props}>
      <path d="M6.5 21.5v-1.7c0-2.9 1-5.3 3-7.4l.6-.6-1.3.5c-.9.4-1.6 1-2.2 1.9l-.7 1c-.4.6-1.3.5-1.6-.1l-.5-1c-.6-1.3-.3-2.8.8-3.7l4.2-3.6c.3-1 .2-1.7-.4-2.5L8.4 4l1.6-.7c.3-.1.4-.4.3-.7l-.4-1 1.6.2c2 .3 3.8 1.4 5 3l3.4 4.6c1.1 1.5 1.7 3.3 1.7 5.2v6.6h-2.7v-4.7c0-.6-.6-1-1.2-.8-2.3.9-3.8 3.1-3.8 5.6v-.1h-7.1z" />
    </svg>
  );
}

export function StarIcon({ className = 'h-3 w-3', ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden {...props}>
      <path d="M12 2.6l2.93 5.94 6.55.95-4.74 4.62 1.12 6.52L12 18.1l-5.86 3.08 1.12-6.52-4.74-4.62 6.55-.95z" />
    </svg>
  );
}

export function BellIcon({ className = 'h-5 w-5', ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...props}
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

export function MicIcon({ className = 'h-4 w-4', ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...props}
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

export function BookmarkIcon({
  filled = false,
  className = 'h-3.5 w-3.5',
  ...props
}: SVGProps<SVGSVGElement> & { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...props}
    >
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.2L5 21V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

export function CloseIcon({ className = 'h-4 w-4', ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      className={className}
      aria-hidden
      {...props}
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function SendIcon({ className = 'h-4 w-4', ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden {...props}>
      <path d="M3.4 20.4l17.5-7.5c.8-.4.8-1.5 0-1.9L3.4 3.6c-.7-.3-1.4.3-1.3 1l1 5.9c.1.4.4.7.8.8l8.1 1.2-8.1 1.2c-.4.1-.7.4-.8.8l-1 5.9c-.1.7.6 1.3 1.3 1z" />
    </svg>
  );
}
