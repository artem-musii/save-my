import { useEffect, useState } from "react";

export function OptionalImage({
  src,
  alt = "",
  className,
  draggable,
  onUnavailable,
}: {
  src?: string | undefined;
  alt?: string;
  className?: string;
  draggable?: boolean;
  onUnavailable?: () => void;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  if (!src || failed) return null;

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      draggable={draggable}
      onError={() => {
        setFailed(true);
        onUnavailable?.();
      }}
    />
  );
}
