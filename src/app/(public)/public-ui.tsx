import type { ReactNode } from "react";

export function PublicMessage({
  icon,
  tone = "sage",
  title,
  success = false,
  children,
}: {
  icon: ReactNode;
  tone?: "sage" | "sand" | "rose";
  success?: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel public-message ${success ? "success" : ""}`}>
      <span className={`job-icon ${tone}`}>{icon}</span>
      <h1>{title}</h1>
      <div className="public-message-body">{children}</div>
    </section>
  );
}

const nextSteps = [
  [
    "CV dibaca dan dinilai",
    "Saring menyembunyikan data seperti foto, agama, dan usia sebelum menilai kecocokanmu.",
  ],
  ["Tim HR meninjau", "Keputusan tetap di tangan tim HR, bukan di tangan AI."],
  [
    "Pilih jadwal interview",
    "Kalau lolos, kamu menerima email berisi link untuk memilih jadwal.",
  ],
];

export function NextSteps() {
  return (
    <ol className="public-steps">
      {nextSteps.map(([title, description], index) => (
        <li key={title}>
          <span>{index + 1}</span>
          <div>
            <strong>{title}</strong>
            <p>{description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
