// Logo Saring: tiga garis yang makin pendek lalu satu titik —
// banyak pelamar disaring menjadi satu talenta yang tepat.
export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4.5 6h15M7.5 10.5h9M10.5 15h3" />
      <circle cx="12" cy="19.4" r="1.45" fill="currentColor" stroke="none" />
    </svg>
  );
}
