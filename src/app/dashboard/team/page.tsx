"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { LoaderCircle, MailPlus, RotateCcw, UserX, X } from "lucide-react";
import { ApiError, post, request } from "@/lib/api";
import { roleLabel } from "@/lib/session";
import { formatDate } from "@/lib/schedule";
import { PageHeading } from "../dashboard-ui";
import { CopyLink } from "../jobs/[id]/copy-link";
import { Select } from "../../ui-select";

const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "recruiter", label: "Rekruter" },
];

type Member = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  active: boolean;
  is_you: boolean;
};
type Invitation = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  expires_at: number;
};

const joinUrl = (token: string) => `${window.location.origin}/join/${token}`;

// Halaman khusus admin perusahaan: anggota tim HR diundang lewat link dan membuat password sendiri.
export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [denied, setDenied] = useState(false);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState({
    email: "",
    display_name: "",
    role: "recruiter",
  });

  const load = useCallback(async () => {
    try {
      const [m, i] = await Promise.all([
        request<{ items: Member[] }>("/team/members"),
        request<{ items: Invitation[] }>("/team-invitations"),
      ]);
      setMembers(m.items);
      setInvites(i.items);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setDenied(true);
      else setError("Data tim tidak bisa dimuat.");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError("");
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Aksi gagal.");
    }
    setBusy("");
  }

  function invite(event: FormEvent) {
    event.preventDefault();
    act("invite", async () => {
      const res = await post<{ token: string }>("/team-invitations", form);
      setLink({ email: form.email, url: joinUrl(res.token) });
      setForm({ email: "", display_name: "", role: "recruiter" });
    });
  }

  if (denied)
    return (
      <>
        <PageHeading
          title="Tim"
          description="Halaman ini khusus admin perusahaan."
        />
        <section className="panel job-panel">
          <p className="job-panel-intro">
            Minta admin perusahaanmu untuk mengatur akun tim.
          </p>
        </section>
      </>
    );

  const activeAdmins = members.filter(
    (m) => m.active && m.role === "admin",
  ).length;

  return (
    <>
      <PageHeading
        title="Tim HR"
        description="Undang rekan HR lewat link. Setiap orang membuat password sendiri; tidak ada yang tahu password orang lain."
      />
      {error && (
        <div className="job-alert" role="alert">
          <span>{error}</span>
        </div>
      )}
      <div className="dashboard-grid">
        <div className="main-column">
          <section className="panel job-panel">
            <h2>Anggota</h2>
            <div className="table-scroll">
              <table className="team-table">
                <thead>
                  <tr>
                    <th>Nama</th>
                    <th>Peran</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Aksi</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const lastAdmin =
                      m.role === "admin" && m.active && activeAdmins <= 1;
                    return (
                      <tr key={m.id} className={m.active ? "" : "inactive"}>
                        <td>
                          <strong>
                            {m.display_name} {m.is_you && <em>(kamu)</em>}
                          </strong>
                          <small>{m.email}</small>
                        </td>
                        <td>
                          <Select
                            className="role-select"
                            aria-label={`Peran ${m.display_name}`}
                            value={m.role}
                            disabled={!m.active || lastAdmin || busy !== ""}
                            title={
                              lastAdmin
                                ? "Organisasi harus punya minimal satu admin"
                                : undefined
                            }
                            onChange={(role) =>
                              act(m.id, () =>
                                request(`/memberships/${m.id}`, {
                                  method: "PATCH",
                                  body: { role },
                                }),
                              )
                            }
                            options={ROLES}
                          />
                        </td>
                        <td>{m.active ? "Aktif" : "Nonaktif"}</td>
                        <td>
                          {m.active ? (
                            <button
                              type="button"
                              className="text-button"
                              disabled={lastAdmin || busy !== ""}
                              title={
                                lastAdmin
                                  ? "Organisasi harus punya minimal satu admin"
                                  : undefined
                              }
                              onClick={() =>
                                act(m.id, () =>
                                  request(`/memberships/${m.id}`, {
                                    method: "PATCH",
                                    body: { active: false },
                                  }),
                                )
                              }
                            >
                              <UserX size={14} /> Nonaktifkan
                            </button>
                          ) : (
                            <small>Undang ulang untuk mengaktifkan</small>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel job-panel">
            <h2>Undangan menunggu</h2>
            {invites.length ? (
              <ul className="team-invites">
                {invites.map((i) => (
                  <li key={i.id}>
                    <div>
                      <strong>{i.display_name}</strong>
                      <small>
                        {i.email} · {roleLabel(i.role)} · berlaku sampai{" "}
                        {formatDate(
                          new Date(i.expires_at * 1000).toISOString(),
                        )}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy !== ""}
                      onClick={() =>
                        act(i.id, async () => {
                          const res = await post<{ token: string }>(
                            `/team-invitations/${i.id}/resend`,
                          );
                          setLink({ email: i.email, url: joinUrl(res.token) });
                        })
                      }
                    >
                      <RotateCcw size={14} /> Kirim ulang
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy !== ""}
                      onClick={() =>
                        act(i.id, () =>
                          post(`/team-invitations/${i.id}/revoke`),
                        )
                      }
                    >
                      <X size={14} /> Batalkan
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="job-panel-intro">
                Tidak ada undangan yang menunggu.
              </p>
            )}
          </section>
        </div>

        <div className="right-column">
          <section className="panel job-panel">
            <h2>Undang anggota</h2>
            <form className="team-form" onSubmit={invite}>
              <label>
                Email kerja
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
              <label>
                Nama
                <input
                  required
                  maxLength={160}
                  value={form.display_name}
                  onChange={(e) =>
                    setForm({ ...form, display_name: e.target.value })
                  }
                />
              </label>
              <label>
                Peran
                <Select
                  aria-label="Peran"
                  value={form.role}
                  onChange={(role) => setForm({ ...form, role })}
                  options={[
                    {
                      value: "recruiter",
                      label: "Rekruter",
                      hint: "Lowongan, kandidat, dan jadwal",
                    },
                    {
                      value: "admin",
                      label: "Admin",
                      hint: "Semua fitur + kelola tim",
                    },
                  ]}
                />
              </label>
              <button
                type="submit"
                className="button primary"
                disabled={busy !== ""}
              >
                {busy === "invite" ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <MailPlus size={15} />
                )}
                Buat link undangan
              </button>
            </form>
            {link && (
              <div className="team-link" role="status">
                <p>
                  Link untuk <strong>{link.email}</strong>. Berlaku 7 hari dan
                  hanya ditampilkan sekali.
                </p>
                <CopyLink url={link.url} />
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
