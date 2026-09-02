import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;
const Icon = ({ children, ...props }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    {children}
  </svg>
);

export const MapIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m3 6 5-2 8 3 5-2v13l-5 2-8-3-5 2Z" />
    <path d="M8 4v13M16 7v13" />
  </Icon>
);
export const BreakIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8" />
    <path d="m13 4-3 7h4l-3 9" />
  </Icon>
);
export const RepairIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14.5 6.5a4 4 0 0 0-5 5L3 18l3 3 6.5-6.5a4 4 0 0 0 5-5l-3 3-3-3Z" />
  </Icon>
);
export const SiteToolsIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 5.5h6v5H4zM14 5.5h6v5h-6zM9 15h6v4H9z" />
    <path d="M7 10.5v2.5h10v-2.5M12 13v2" />
  </Icon>
);
export const VerifyIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 12.5 9 17l11-11" />
  </Icon>
);
export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4" />
  </Icon>
);
export const PersonIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="8" r="3" />
    <path d="M5.5 20c.7-4 2.9-6 6.5-6s5.8 2 6.5 6" />
  </Icon>
);
export const ZoomInIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M10.5 7v7M7 10.5h7M16 16l4 4" />
  </Icon>
);
export const ZoomOutIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M7 10.5h7M16 16l4 4" />
  </Icon>
);
export const ResetIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 9a8 8 0 1 1 2 8.5M4 4v5h5" />
  </Icon>
);
export const ListIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
    <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
  </Icon>
);
export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5 5 14 14M19 5 5 19" />
  </Icon>
);
export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h16M9 3h6l1 4H8l1-4Z" />
    <path d="m6.5 7 .8 14h9.4l.8-14M10 11v6M14 11v6" />
  </Icon>
);
export const ArrowIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12h14M14 7l5 5-5 5" />
  </Icon>
);
export const MoreIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="5" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="19" cy="12" r="1" fill="currentColor" />
  </Icon>
);
