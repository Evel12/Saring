// Animasi pembuka dashboard: diputar sekali per sesi browser.
export const INTRO_KEY = "saring-intro";
const INTRO_MS = 1200;

// Versi skrip untuk <head>, supaya kelas terpasang sebelum halaman pertama
// kali tampil. Isinya sama dengan playIntro di bawah.
export const INTRO_SCRIPT = `try{if(location.pathname.indexOf("/dashboard")===0&&!sessionStorage.getItem("${INTRO_KEY}")&&!matchMedia("(prefers-reduced-motion: reduce)").matches){sessionStorage.setItem("${INTRO_KEY}","1");var d=document.documentElement;d.classList.add("intro");setTimeout(function(){d.classList.remove("intro")},${INTRO_MS})}}catch(e){}`;

// Untuk dashboard yang dibuka lewat navigasi klien, misalnya setelah login.
export function playIntro() {
  try {
    if (
      sessionStorage.getItem(INTRO_KEY) ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    sessionStorage.setItem(INTRO_KEY, "1");
    const root = document.documentElement;
    root.classList.add("intro");
    setTimeout(() => root.classList.remove("intro"), INTRO_MS);
  } catch {}
}

export function resetIntro() {
  try {
    sessionStorage.removeItem(INTRO_KEY);
  } catch {}
}
