declare module '@hugeicons/react' {
  import * as React from 'react';
  export const HugeiconsIcon: React.FC<{
    icon: unknown;
    size?: number;
    color?: string;
    strokeWidth?: number;
    className?: string;
    style?: React.CSSProperties;
  }>;
}

declare module '@hugeicons/core-free-icons' {
  export const Mail01Icon: unknown;
  export const WhatsappIcon: unknown;
  export const WhatsappBusinessIcon: unknown;
  const icons: Record<string, unknown>;
  export default icons;
}
