import React from 'react';

/**
 * Lucide-style stroke icons: 24×24 viewBox, stroke-width 2, round caps and
 * joins, drawn in currentColor. Rendered at 13–17px per the design system.
 * Inline rather than imported from lucide-react so this surface carries no
 * icon dependency and the stroke weight stays under our control (same rule
 * as src/hr/icons.tsx).
 */

interface IconProps {
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}

const Svg = ({
  size = 17,
  color = 'currentColor',
  style,
  children,
}: IconProps & { children: React.ReactNode }): JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    style={{ flexShrink: 0, ...style }}
  >
    {children}
  </svg>
);

export const Inbox = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </Svg>
);

export const Route = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="6" cy="19" r="3" />
    <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
    <circle cx="18" cy="5" r="3" />
  </Svg>
);

export const FileText = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </Svg>
);

export const Activity = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </Svg>
);

export const CircleDollarSign = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
    <path d="M12 18V6" />
  </Svg>
);

export const Sun = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </Svg>
);

export const Moon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </Svg>
);

export const ArrowLeft = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </Svg>
);

export const ExternalLink = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </Svg>
);

export const Paperclip = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </Svg>
);

export const X = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Svg>
);

export const Check = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);
