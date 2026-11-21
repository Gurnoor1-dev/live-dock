import { ArrowUpRight } from "lucide-react";

const messages:Record<string,string>={
  configuration:"Infinite Flight OAuth is not configured yet. Add the required server environment variables in Vercel.",
  denied:"You cancelled or denied Infinite Flight authorisation.",
  state:"The sign-in session expired or could not be verified. Please try again.",
  token:"Infinite Flight did not issue an access token. Check your OAuth client and redirect URI."
};

export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string}>}){
  const params=await searchParams;
  const error=params.error||"";
  return <main className="auth-page"><a href="/" className="brand"><span className="brand-mark">VB</span><span>VIRTUAL BLUE<small>FLEET OPERATIONS</small></span></a><section className="auth-card"><p className="eyebrow">INFINITE FLIGHT · OAUTH 2.0</p><h1>Welcome aboard.</h1><p className="muted">Sign in securely with your Infinite Flight account. Your Live organisation membership controls what you can access.</p>{error&&<p className="form-error" role="alert">{messages[error]||"Sign-in could not be completed."}</p>}<a className="primary-button full" href="/api/auth/if/login">Continue with Infinite Flight <ArrowUpRight size={15}/></a><p className="fine-print">No Virtual Blue email or password is required. Infinite Flight handles your authentication and consent.</p></section></main>;
}
