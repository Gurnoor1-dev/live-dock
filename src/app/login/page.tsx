"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
      if (error) throw error;
      setMessage("Check your inbox for your secure sign-in link.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to send sign-in link."); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><Link href="/" className="brand"><span className="brand-mark">VB</span><span>VIRTUAL BLUE<small>FLEET OPERATIONS</small></span></Link><section className="auth-card"><p className="eyebrow">PILOT ACCESS</p><h1>Welcome aboard.</h1><p className="muted">Sign in with your Virtual Blue account to access fleet operations.</p><form onSubmit={submit}><label htmlFor="email">Email address</label><input id="email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="pilot@example.com"/><button className="primary-button full" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in link"}</button></form>{message && <p className="notice" role="status">{message}</p>}<p className="fine-print">Access is controlled by Virtual Blue membership. Contact an administrator if you need an invitation.</p></section></main>;
}
