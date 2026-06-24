import { cn } from "@/lib/utils";

type LogoMarkProps = {
  className?: string;
  title?: string;
};

export function LogoMark({ className, title }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("h-10 w-10 shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      xmlns="http://www.w3.org/2000/svg"
    >
      {title ? <title>{title}</title> : null}
      <rect
        x="25"
        y="7"
        width="14"
        height="50"
        rx="7"
        className="fill-health-accent"
      />
      <rect
        x="7"
        y="25"
        width="50"
        height="14"
        rx="7"
        className="fill-health-accent"
      />
      <circle
        cx="28"
        cy="28"
        r="11"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        className="text-white"
      />
      <path
        d="M36.5 36.5 48.5 48.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="7"
        className="text-amber-300"
      />
      <path
        d="m23.5 29.5 4.25 4.25 8.75-9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3.5"
        className="text-amber-300"
      />
    </svg>
  );
}

type BrandLogoProps = {
  className?: string;
  markClassName?: string;
  textClassName?: string;
  showText?: boolean;
};

export default function BrandLogo({
  className,
  markClassName,
  textClassName,
  showText = true,
}: BrandLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} aria-label="Apošteka">
      <LogoMark className={markClassName} />
      {showText ? (
        <span
          className={cn(
            "leading-none font-extrabold tracking-normal text-2xl text-slate-900 dark:text-white",
            textClassName
          )}
        >
          Apo<span className="text-health-secondary dark:text-health-accent">šteka</span>
        </span>
      ) : null}
    </span>
  );
}
