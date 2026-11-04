const PATHS = {
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5-9 9" />
    </>
  ),
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  check: <path d="m5 12 5 5 9-10" />,
  palette: (
    <>
      <path d="M12 3a9 9 0 0 0 0 18c1.4 0 2-1 2-2 0-1.5-1.5-1.6-1.5-3 0-1.1.9-2 2-2H17a4 4 0 0 0 4-4c0-3.9-4-7-9-7Z" />
      <circle cx="7.5" cy="11" r="1" />
      <circle cx="10" cy="7" r="1" />
      <circle cx="15" cy="7.5" r="1" />
    </>
  ),
  alignLeft: (
    <>
      <rect x="3" y="5" width="8" height="8" rx="1.5" />
      <path d="M14 6h7M14 10h7M3 17h18" />
    </>
  ),
  alignCenter: (
    <>
      <rect x="7" y="4" width="10" height="9" rx="1.5" />
      <path d="M4 17h16M7 20h10" />
    </>
  ),
  alignRight: (
    <>
      <rect x="13" y="5" width="8" height="8" rx="1.5" />
      <path d="M3 6h7M3 10h7M3 17h18" />
    </>
  ),
  alignFull: (
    <>
      <rect x="3" y="5" width="18" height="11" rx="1.5" />
      <path d="M3 20h18" />
    </>
  ),
  rotate: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
  crop: (
    <>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
